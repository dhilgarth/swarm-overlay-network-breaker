import {
    DataDockerNetwork
} from '@sovarto/cdktf-provider-docker/data-docker-network/data-docker-network';
import { Network } from '@sovarto/cdktf-provider-docker/network/network';
import { DockerProvider } from '@sovarto/cdktf-provider-docker/provider/provider';
import { Service } from '@sovarto/cdktf-provider-docker/service/service';
import { TerraformStack } from 'cdktf';
import { Construct } from 'constructs';

interface Options {
    managerIp: string;
    allIpAddresses: string[];
}

export { Options as ServicesStackOptions };

export class ServicesStack extends TerraformStack {
    constructor(scope: Construct, name: string, options: Options) {
        super(scope, name);

        new DockerProvider(this, 'docker', {
            // host: `ssh://root@${ options.managerIp }`,
            // sshOpts: [ '-o', 'StrictHostKeyChecking=no' ]
        });

        const hostNetwork = new DataDockerNetwork(this, 'host-network', {
            name: 'host'
        });

        const web = new Network(this, 'web', {
            name: 'web',
            attachable: true,
            driver: 'overlay'
        });

        const internal = new Network(this, 'internal', {
            name: 'internal',
            attachable: true,
            driver: 'overlay'
        });

        new Service(this, 'network-watcher', {
                name: 'network-watcher',
                lifecycle: { ignoreChanges: [ 'task_spec[0].networks_advanced' ] },
                taskSpec: {
                    containerSpec: {
                        image: 'sovarto/swarm-network-fixer:2.0.0-beta5',
                        env: {
                            ONLY_REPORT_ERRORS: 'true'
                        },
                        mounts: [
                            {
                                type: 'bind',
                                source: '/var/run/docker.sock',
                                target: '/var/run/docker.sock'
                            }
                        ]
                    },
                    networksAdvanced: [ { name: hostNetwork.id } ],
                },
                mode: { global: true }
            }
        );

        new Service(this, 'crashing-service', {
            name: 'crashing-service',
            taskSpec: {
                containerSpec: {
                    image: 'ubuntu',
                    command: [ 'sleep', '1', '&&', 'exit', '1' ]
                },
                networksAdvanced: [ { name: web.id }, { name: internal.id } ]
            },
            mode: { replicated: { replicas: 7 } }
        });

        new Service(this, 'stressor', {
            name: 'stressor',
            taskSpec: {
                containerSpec: {
                    image: 'alexeiled/stress-ng',
                    args: [
                        '--cpu',
                        '2',
                        '--io',
                        '2',
                        '--vm',
                        '1',
                        '--vm-bytes',
                        '1G',
                        '--timeout',
                        '600s',
                        '--metrics-brief'
                    ]
                }
            },
            mode: { global: true }
        });

        const id = Date.now(); // We want to recreate the services whenever we deploy

        for (let i = 1; i <= 7; ++i) {
            const global = new Service(this, `network-breaker-global-${ i }`, {
                name: `network-breaker-global-${ i }`,
                taskSpec: {
                    containerSpec: {
                        image: 'traefik/whoami',
                        env: {
                            DUMMY: `${ id }`
                        },
                    },
                    networksAdvanced: [ { name: web.id }, { name: internal.id } ]
                },
                mode: { global: true }
            });

            new Service(this, `network-breaker-replicated-${ i }`, {
                name: `network-breaker-replicated-${ i }`,
                taskSpec: {
                    containerSpec: {
                        image: 'fedora',
                        env: {
                            DUMMY: `${ id }`
                        },
                        command: [
                            'sh',
                            '-c',
                            `while true; do curl -s http://network-breaker-global-${ i } --connect-timeout 5 -v; sleep 10; done`
                        ]
                    },
                    networksAdvanced: [ { name: web.id }, { name: internal.id } ]
                },
                mode: { replicated: { replicas: 5 } },
                dependsOn: [ global ]
            });
        }

        for (const location of [ 'fsn1', 'nbg1' ]) {
            const ipVisibility = 'private';
            const serviceName = `${ name }-${ location }-${ ipVisibility }`;
            const env: Record<string, string> = {
                MEMBERLIST_KNOWN_MEMBERS: options.allIpAddresses.join(','),
                ADDITIONAL_LABELS: `location=${ location },ip=${ ipVisibility }`,
                MEMBERLIST_INTERFACES: 'enp7s0',
                MEMBERLIST_PORT: '10102',
                METRICS_SERVER_PORT: `9999`,
                NODE_NAME: `{{ .Node.Hostname }}-${ ipVisibility }`,
                NUMBER_OF_NODES_TO_CONNECT_TO: '6',
                LOG_PING_ACK_MESSAGES: 'true'
            };

            new Service(this, serviceName, {
                name: serviceName,
                lifecycle: { ignoreChanges: [ 'task_spec[0].networks_advanced' ] },
                taskSpec: {
                    containerSpec: {
                        image: 'sovarto/meshed-connection-tester:1.0.3',
                        env
                    },
                    networksAdvanced: [ { name: hostNetwork.id } ],
                    placement: {
                        constraints: [ `node.labels.location == ${ location }` ],
                    }
                },
                updateConfig: {
                    delay: '5s',
                    monitor: '30s',
                    order: 'stop-first',
                    failureAction: 'continue'
                },
                mode: { global: true }
            });
        }
    }
}
