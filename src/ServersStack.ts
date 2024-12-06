import { File as LocalFile } from '@cdktf/provider-local/lib/file';
import { LocalProvider } from '@cdktf/provider-local/lib/provider';
import { SensitiveFile } from '@cdktf/provider-local/lib/sensitive-file';
import { PrivateKey } from '@cdktf/provider-tls/lib/private-key';
import { TlsProvider } from '@cdktf/provider-tls/lib/provider';
import { DataHcloudImage } from '@sovarto/cdktf-provider-hcloud/data-hcloud-image';
import { Network } from '@sovarto/cdktf-provider-hcloud/network';
import { NetworkSubnet } from '@sovarto/cdktf-provider-hcloud/network-subnet';
import { HcloudProvider } from '@sovarto/cdktf-provider-hcloud/provider';
import { Server } from '@sovarto/cdktf-provider-hcloud/server';
import { SshKey } from '@sovarto/cdktf-provider-hcloud/ssh-key';
import { Resource, SshProvider } from '@sovarto/cdktf-provider-ssh';
import { fileHash } from '@sovarto/cdktf-utils';
import { Fn, TerraformLocal, TerraformOutput, TerraformStack } from 'cdktf';
import { Construct } from 'constructs';
import * as path from 'node:path';
import {
    bashPrompt,
    createDockerGwBridge,
    dockerDaemonJson,
    dockerLogin,
    initSwarm,
    installDocker,
    installNode,
    joinSwarm,
    pullDefaultImages,
    restartDocker,
    waitForInterface
} from './cloudInit/templates';
import { generateCloudInit } from './cloudInit/types';

interface Options {
    image: string;
    installDockerManually: boolean;
    workers: number;
    dockerUser: string;
    dockerPassword: string;
    hetznerToken: string;
    additionalSshKeyName?: string;
}

export { Options as ServersStackOptions };

export class ServersStack extends TerraformStack {
    managerIp: string;
    servers: Server[];
    sshPrivateKey: string;

    constructor(scope: Construct, name: string, options: Options) {
        super(scope, name);

        new LocalProvider(this, 'local');
        new TlsProvider(this, 'tls');
        new SshProvider(this, 'ssh');
        new HcloudProvider(this, 'hetzner', {
            token: options.hetznerToken
        });

        const image = new DataHcloudImage(this, 'server-image', {
            name: options.image,
            mostRecent: true,
            withArchitecture: 'x86'
        });

        const privateKey = new PrivateKey(this, 'private-key', {
            algorithm: 'RSA',
            rsaBits: 4096
        });

        this.sshPrivateKey = privateKey.privateKeyPem;

        const sshKey = new SshKey(this, 'ssh-key', {
            name: `${ name }-ssh-key`,
            publicKey: privateKey.publicKeyOpenssh
        });

        const sshKeys = [sshKey.name]
        if (options.additionalSshKeyName?.length) {
            sshKeys.push(options.additionalSshKeyName)
        }

        const network = new Network(this, 'network', {
            name: `${ name }-private`,
            ipRange: '172.16.0.0/12'
        });

        const networkId = Fn.parseint(network.id, 10);

        const subnet = new NetworkSubnet(this, 'subnet', {
            networkId,
            ipRange: '172.16.0.0/12',
            networkZone: 'eu-central',
            type: 'cloud'
        });

        const initialSwarmManagerCloudInit = createCloudInit(this,
            name,
            'initial-swarm-manager',
            initSwarm());

        const primaryManagerIp = getIpAddress(1);
        const initialSwarmManager = createCloudServer(this,
            'swarm-manager',
            1, 'nbg1',
            initialSwarmManagerCloudInit,
            primaryManagerIp);

        syncFileToServer(this,
            'network-checker',
            initialSwarmManager.ipv4Address,
            path.resolve(__dirname, 'network-checker.js'),
            '/network-checker.js',
            true);

        syncFileToServer(this,
            'show_watcher_logs',
            initialSwarmManager.ipv4Address,
            path.resolve(__dirname, 'show_watcher_logs.sh'),
            '/show_watcher_logs.sh',
            true);

        const getTokens = new Resource(this, 'get_tokens', {
            host: initialSwarmManager.ipv4Address,
            user: 'root',
            privateKey: privateKey.privateKeyPem,
            file: [
                {
                    source: path.resolve(__dirname, 'get_swarm_tokens.sh'),
                    destination: '/get_swarm_tokens.sh',
                    permissions: '0700'
                }
            ],
            commands: [ '/get_swarm_tokens.sh' ],
            timeout: '2m'
        });

        const tokens = new TerraformLocal(this, 'tokens', Fn.jsondecode(getTokens.result));

        const remainingSwarmManagersCloudInit = createCloudInit(this,
            name, 'remaining-swarm-managers',
            [ joinSwarm(Fn.lookup(tokens, 'manager'), primaryManagerIp) ]);

        const swarmWorkersCloudInit = createCloudInit(this, name, 'swarm-workers',
            [ joinSwarm(Fn.lookup(tokens, 'worker'), primaryManagerIp) ]);

        const remainingSwarmManagers = [ 2, 3 ].map(x => createCloudServer(this,
            'swarm-manager',
            x,
            x === 2 ? 'fsn1' : 'nbg1',
            remainingSwarmManagersCloudInit,
            getIpAddress(x)));

        const workers = Array.from({ length: options.workers })
                             .map((_, i) => createCloudServer(this,
                                 'swarm-worker',
                                 i + 1,
                                 i % 2 === 0 ? 'fsn1' : 'nbg1',
                                 swarmWorkersCloudInit,
                                 getIpAddress(i + 4)));

        const servers = [
            initialSwarmManager,
            ...remainingSwarmManagers,
            ...workers
        ];

        servers.map(x => {
            new Resource(this, `${ x.nameInput! }-set-node-label`, {
                host: initialSwarmManager.ipv4Address,
                user: 'root',
                privateKey: privateKey.privateKeyPem,
                timeout: '2m',
                commands: [ `docker node update --label-add location=${ x.location } ${ x.name }` ]
            });
        });

        const privateKeyFile = new SensitiveFile(this, 'private-key-file', {
            content: privateKey.privateKeyPem,
            filePermission: '0600',
            filename: path.resolve(process.cwd(), name, 'id_rsa')
        });

        new LocalFile(this, 'ssh.config', {
            content: `Host swarm-manager-1
  HostName ${ initialSwarmManager.ipv4Address }
  IdentityFile ${ privateKeyFile.filename }
  StrictHostKeyChecking no`,
            filename: path.resolve(process.cwd(), name, 'ssh.config')
        });

        new TerraformOutput(this,
            'servers',
            { value: Object.fromEntries(servers.map(x => ([ x.nameInput!, x.ipv4Address ]))) });

        this.managerIp = initialSwarmManager.ipv4Address;
        this.servers = servers;

        function createCloudServer(scope: Construct,
                                   nodeTypeName: string,
                                   index: number,
                                   location: string,
                                   cloudInit: TerraformLocal,
                                   privateIp?: string) {
            const serverName = `${ nodeTypeName }-${ index }`;
            return new Server(scope, serverName, {
                name: `${ name }-${ serverName }`,
                location,
                serverType: 'cx22',
                image: Fn.tostring(image.id),
                publicNet: [
                    {
                        ipv4Enabled: true,
                    }
                ],
                sshKeys,
                network: [ { networkId, ip: privateIp } ],
                userData: cloudInit.asString,
                dependsOn: [ subnet ]
            });
        }

        function createCloudInit(scope: Construct,
                                 projectName: string,
                                 namePrefix: string,
                                 specificConfig: { type: string, data: any }[]) {
            return new TerraformLocal(scope,
                `${ namePrefix }-cloud-init`,
                escapeDollarSign(generateCloudInit([
                    ...(options.installDockerManually ? [ installDocker() ] : []),
                    dockerDaemonJson(),
                    ...bashPrompt(projectName, 'dev'),
                    waitForInterface(),
                    restartDocker(),
                    createDockerGwBridge(),
                    dockerLogin(options.dockerUser, options.dockerPassword),
                    ...specificConfig,
                    ...pullDefaultImages(),
                    installNode()
                ])));
        }

        function syncFileToServer(scope: Construct,
                                  name: string,
                                  host: string,
                                  localFilePath: string,
                                  remoteFilePath: string,
                                  reuploadOnFileChange: boolean) {
            const triggers = reuploadOnFileChange ? { hash: fileHash(localFilePath) } : undefined;
            new Resource(scope, `sync_${ name }`, {
                host,
                user: 'root',
                privateKey: privateKey.privateKeyPem,
                file: [
                    {
                        source: localFilePath,
                        destination: remoteFilePath,
                        permissions: '0700'
                    }
                ],
                triggers
            });
        }
    }
}

function getIpAddress(index: number) {
    return `172.16.0.${ index + 1 }`;
}

function escapeDollarSign(input: string) {
    return input.replace(/\$\{/g, '$$$${').replace(/\$\$\{TfToken/g, '$${TfToken');
}
