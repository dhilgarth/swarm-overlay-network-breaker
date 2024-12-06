import { App } from 'cdktf';
import { ServersStack, ServersStackOptions } from './ServersStack';
import { ServicesStack } from './ServicesStack';

export function synth() {
    const app = new App();
    deploy(app, 'docker27', { image: 'docker-ce', installDockerManually: false, workers: 15 });
    deploy(app, 'docker24', { image: 'ubuntu-22.04', installDockerManually: true, workers: 15 });
    app.synth();
}

function deploy(app: App,
                name: string,
                options: Omit<ServersStackOptions, 'additionalSshKeyName' | 'dockerUser' | 'dockerPassword' | 'hetznerToken'>) {

    const commonOptions = {
        dockerUser: process.env.DOCKER_USER!,
        dockerPassword: process.env.DOCKER_PASSWORD!,
        hetznerToken: process.env.HETZNER_TOKEN!,
        additionalSshKeyName: process.env.ADDITIONAL_SSH_KEY_NAME
    };
    const servers = new ServersStack(app, name, {...commonOptions, ...options});
    new ServicesStack(app,
        `${ name }-services`,
        {
            managerIp: servers.managerIp,
            allIpAddresses: servers.servers.map(x => x.network.get(0).ip)
        });
}
