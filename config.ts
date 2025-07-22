import { Host, Docker } from "./types";
import * as pulumi from "@pulumi/pulumi";
import { ProviderArgs, vm } from "@muhlba91/pulumi-proxmoxve";
import * as tls from "@pulumi/tls";

// Generate an RSA private key (2048-bit by default)
export const genKey = new tls.PrivateKey("private-key", { algorithm: "RSA" });

// Load stack config
const cfg = new pulumi.Config();

export const proxmoxProviderArgConf = cfg.requireObject<ProviderArgs>("provider");
export const keysConf = cfg.requireObject<string[]>("keys");
export const argsConf = cfg.requireObject<vm.VirtualMachineArgs>("VM");
export const dockerConf = cfg.requireObject<Docker>("docker");

// Combine existing keys with the new public key
export const publicKeys = pulumi
    .all([keysConf, genKey.publicKeyOpenssh])
    .apply(([cfgKeys, genKey]) => [...cfgKeys, genKey]);

// Merge public keys into the VM initialization userAccount keys.
export const vmArgs = {
    ...argsConf,
    initialization: pulumi.output(argsConf.initialization).apply(init => ({
        ...init,
        userAccount: {
            ...(init?.userAccount ?? {}),
            keys: publicKeys,
        },
    })),
};

// Extract the VM IP (IPv4 or IPv6) and strip CIDR.
export const vmIp = vmArgs.initialization.apply(init => {
    const ip = init?.ipConfigs
        ?.map(cfg => cfg.ipv4?.address || cfg.ipv6?.address)
        .find(Boolean);
    if (!ip) throw new Error("No IPv4 or IPv6 address found in ipConfigs.");
    return ip.split("/")[0]; // Strip CIDR; example: 192.168.2.3/24 -> 192.168.2.3
});

// Extract user account info, with validation.
export const vmUserAccount = vmArgs.initialization.apply(init => {
    const user = init?.userAccount;
    if (!user || !user.username) 
        throw new Error("Missing userAccount or username in VM initialization.");
    return {
        keys: user.keys ?? [],
        username: user.username,
        password: user.password ?? "",
    };
});

// Build SSH connection args 
export const connectionArgs = {
    host: vmIp,
    port: 22,
    user: vmUserAccount.username,
    privateKey: pulumi.secret(genKey.privateKeyOpenssh),
}

// Build Ansible hosts configuration, combining outputs safely
export const hostsConf: pulumi.Output<Host[]> = pulumi.all([
    vmArgs.name,
    vmIp, 
    vmUserAccount.username, 
    vmUserAccount.password,
]).apply(([name, ip, username, password]) => [{
    name: name as string,
    ip: ip as string,
    username: username as string,
    password: password as string
}]);