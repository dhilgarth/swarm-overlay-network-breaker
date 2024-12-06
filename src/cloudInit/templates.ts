import { file, templateFile } from '@sovarto/cdktf-utils';

export function dockerDaemonJson() {
    return {
        type: 'write_files',
        data: {
            content: JSON.stringify({ bip: '192.168.0.1/19', mtu: 1450 }),
            path: '/etc/docker/daemon.json',
            owner: 'root:root',
            permissions: '0644'
        }
    };
}

export function bashPrompt(projectName: string, environmentName: string) {
    return [
        {
            type: 'write_files',
            data: {
                path: '/root/.bash_prompt',
                content: templateFile(__dirname,
                    'bash_prompt.sh',
                    {
                        PROJECT_NAME: projectName,
                        ENVIRONMENT_NAME: environmentName
                    }),
                owner: 'root:root',
                permissions: '0644'
            }
        }, {
            type: 'runcmd',
            data: `if ! grep -q '^[ ]*\\[ -f ~/.bash_prompt \\] && . ~/.bash_prompt' /root/.bashrc; then
  echo '[ -f ~/.bash_prompt ] && . ~/.bash_prompt' >> /root/.bashrc
fi`
        }
    ];
}

export function restartDocker() {
    return { type: 'runcmd', data: 'systemctl restart docker.service' };
}

export function createDockerGwBridge() {
    return {
        type: 'runcmd', data: `docker_gwbridge_network_address_pool="192.168.32.0/19"
docker_gwbridge_mtu=1450

if ! docker network ls | grep -q docker_gwbridge; then
  docker network create --subnet \${docker_gwbridge_network_address_pool} \\
    --opt com.docker.network.bridge.name=docker_gwbridge \\
    --opt com.docker.network.bridge.enable_icc=false \\
    --opt com.docker.network.driver.mtu=\${docker_gwbridge_mtu} docker_gwbridge
fi
    `
    };
}

export function initSwarm() {
    return [
        {
            type: 'write_files',
            data: {
                path: '/usr/local/bin/init_swarm.sh',
                content: file(__dirname, 'init_swarm.sh'),
                owner: 'root:root',
                permissions: '0755'
            }
        }, {
            type: 'runcmd',
            data: '/usr/local/bin/init_swarm.sh'
        }
    ];
}

export function joinSwarm(token: string, primaryManagerIp: string) {
    return {
        type: 'runcmd',
        data: `docker swarm join --token ${ token } ${ primaryManagerIp }:2377`
    };
}

export function waitForInterface() {
    return {
        type: 'runcmd',
        data: `while ! ip link show enp7s0 > /dev/null 2>&1; do
  echo "Waiting for network interface enp7s0..."
sleep 1
done
echo "Network interface enp7s0 is now available."`
    };
}

export function installDocker() {
    return {
        type: 'packages',
        data: 'docker.io'
    };
}

export function dockerLogin(user: string, password: string) {
    return {
        type: 'runcmd',
        data: `docker login -u ${user} -p ${password}`
    };
}

export function pullDefaultImages() {
    return [
        'traefik/whoami',
        'ubuntu',
        'fedora',
        'alpine',
        'sovarto/enable-docker-network-diagnostic-server:1.0.0'
    ].map(x => ({ type: 'runcmd', data: `docker pull ${ x }` }));
}

export function installNode() {
    return {
        type: 'runcmd', data: 'curl -sL https://deb.nodesource.com/setup_20.x | bash && apt-get install nodejs -y'
    }
}
