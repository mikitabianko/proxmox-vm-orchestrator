import * as pulumi from "@pulumi/pulumi";
import * as proxmoxve from "@muhlba91/pulumi-proxmoxve";
import { remote, local } from "@pulumi/command";

import { proxmoxProviderArgConf, connectionArgs, vmArgs, genKey, dockerConf, hostsConf, vmIp } from "./config";
import { readFiles, createAnsibleInventory, writeFiles } from "./utils";

export = async () => {
    // Preparing workspace for Ansible playbooks
    const ansibleHash = pulumi
        .all([dockerConf, hostsConf])
        .apply(async ([dockerCfg, hostsCfg]) =>
            writeFiles("./workspace/ansible", [
                ...(await readFiles("./ansible")),
                await createAnsibleInventory("./ansible/inventory.js", { dockerCfg, hostsCfg }),
            ])
        );
    const keysHash = pulumi
        .all([
            genKey.publicKeyOpenssh,
            genKey.privateKeyOpenssh,
        ]).apply(([publicKey, privateKey]) =>
            writeFiles("./workspace", [
                { parentPath: "./", path: "./id_rsa.pub", name: "id_rsa.pub", data: Buffer.from(publicKey), options: { mode: 0o644 } },
                { parentPath: "./", path: "./id_rsa",    name: "id_rsa",     data: Buffer.from(privateKey), options: { mode: 0o600 } },
            ])
        );

    // Creating VM and waiting for SSH to be up
    const provider = new proxmoxve.Provider("provider", proxmoxProviderArgConf);
    const VMR = new proxmoxve.vm.VirtualMachine("VMR", vmArgs, { provider: provider });
    const connection = new remote.Command("check-ready", {
        connection: connectionArgs,
        create: "echo SSH is up",
    }, { dependsOn: [VMR] });

    // Waiting for cloud-init to complete
    const waitCloudInit = new local.Command("cloud-init", {
        create: pulumi.interpolate`
        ANSIBLE_CONFIG=./workspace/ansible/ansible.cfg \
        ANSIBLE_HOST_KEY_CHECKING=False \
        ansible-playbook -i ./workspace/ansible/inventory.json \
        --private-key ./workspace/id_rsa \
        ./workspace/ansible/cloud-init.yml`
    }, {
        dependsOn: [connection]
    });

    // Running Ansible playbooks
    const playAnsiblePlaybook = new local.Command("playAnsiblePlaybook", {
        create: pulumi.interpolate`
        ANSIBLE_CONFIG=./workspace/ansible/ansible.cfg \
        ANSIBLE_HOST_KEY_CHECKING=False \
        ansible-playbook -i ./workspace/ansible/inventory.json \
        --private-key ./workspace/id_rsa \
        ./workspace/ansible/playbook.yml`,
        triggers: [ansibleHash],
    }, {
        dependsOn: [waitCloudInit],
    });

    return { vhost: vmIp };
}