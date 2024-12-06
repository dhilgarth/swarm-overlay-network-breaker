import * as yaml from 'js-yaml';

// Base Cloud-Init interface
export interface CloudInit {
    hostname?: string;
    manage_etc_hosts?: boolean;
    users?: User[];
    packages?: string[];
    runcmd?: string[];
    write_files?: WriteFile[];
    package_upgrade?: boolean;
    apt?: AptConfig;
    bootcmd?: string[];
    timezone?: string;
    locale?: string;
    groups?: string[];
}

// User definition
export interface User {
    name: string;
    gecos?: string;
    sudo?: string;
    shell?: string;
    ssh_authorized_keys?: string[];
    groups?: string[];
    lock_passwd?: boolean;
    passwd?: string;
}

// WriteFile definition
export interface WriteFile {
    path: string;
    permissions?: string;
    owner?: string;
    content: string;
    append?: boolean;
    encoding?: string;
}

// AptConfig definition
export interface AptConfig {
    upgrade: 'safe' | 'full' | 'dist';
    update: boolean;
    sources?: AptSource[];
}

// AptSource definition
export interface AptSource {
    source: string;
    keyid?: string;
}

// Function to generate Cloud-Init YAML
export function generateCloudInit(configs: {
    type: string,
    data: any
}[]): string {
    const cloudInitConfig = configs.reduce<Record<string, any>>((acc, curr) => {
        if (!acc[curr.type]) {
            acc[curr.type] = [ curr.data ] as any;
        } else {
            (acc[curr.type] as any).push(curr.data);
        }
        return acc;
    }, {});

    return `#cloud-config\n${ yaml.dump(cloudInitConfig, { noRefs: true }) }`;
}

// type ElementType<T> = T extends (infer U)[] ? U : never;
//
// export type TemplateTypes = 'users' | 'packages' | 'runcmd' | 'write_files' | 'bootcmd' | 'groups'
// export type Config<T extends TemplateTypes> = {
//     type: T,
//     data: ElementType<CloudInit[T]>
// }
