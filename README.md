## Introduction

This repository contains the resources and code for the tutorial "How to Automatically Provision New (Proxmox) VMs Using Pulumi and Ansible". 

## Configure VM Settings via Pulumi Config
We will use Pulumi’s configuration system (`pulumi config`) to define parameters for the Proxmox provider, SSH keys, the VM itself, and Docker images. These values will be loaded into our Pulumi program.

- **Provider**: Add Proxmox API details. In `Pulumi.dev.yaml`:
```yml
config:
	...
	proxmox:provider:
	    endpoint: https://proxmox...
	    insecure: true
	    apiToken: ...
```
You can set these via the Pulumi CLI:
```bash
pulumi config set --path "provider.endpoint" {endpoint}
pulumi config set --path "provider.insecure" {insecure} --type bool  
pulumi config set --secure --path "provider.apiToken" {token}
```
---
- **SSH Keys**: Define public keys for the VM’s default user:
```yml
config:
	...
	proxmox:keys:
	    - ssh-rsa AAAAB3NzaC... user1@example.com
	    - ssh-rsa AAAAB3NzaD... user2@example.com
```
You can set these via the Pulumi CLI:
```bash
pulumi config set --path 'keys[0]' 'ssh-rsa AAAAB3NzaC... user1@example.com'
pulumi config set --path 'keys[1]' 'ssh-rsa AAAAB3NzaD... user2@example.com'
```
> These keys will be injected via Cloud-Init so we can SSH in.
---
- **VM Initialization**: Under `proxmox:VM`, specify VM parameters matching [VirtualMachineArgs](https://www.pulumi.com/registry/packages/proxmoxve/api-docs/vm/virtualmachine/#inputs). For example:
```yml
config:
	...
	proxmox:VM:
		initialization:
			type: nocloud # using NoCloud for cloud-init
			datastoreId: local
			dns:
				servers:
				- 10.3.0.2
			ipConfigs:
				- ipv4:
				address: 10.3.0.201/24
				gateway: 10.3.0.2
			userAccount:
				username: user
				password: password
		nodeName: prox01
		agent:
			enabled: false
			trim: true
			type: virtio
		cpu:
			cores: 4
			sockets: 2
		type: kvm64
		clone:
			nodeName: prox01
			vmId: 900
		disks:
			- interface: scsi0
			datastoreId: local
			size: 32
			fileFormat: qcow2
		memory:
			dedicated: 4096
		name: littePig
```
-  `clone` tells Proxmox which template (VM 900 on node prox01) to use as the base.
- `initialization` block sets up cloud-init: using NoCloud, network config, and initial user. Pulumi will add the SSH keys into `userAccount.keys` later.
>**Important**: You don’t need to specify access keys in `userAccount`. They are configured separately using the `keys` field.
---
- **Docker images**: Define in config which Docker images Ansible should pull:
```yml
config:
	proxmox:docker:
		images:
		  - harbor...
		  - ...  
```
Or via CLI:
```bash
pulumi config set --path "docker.images[0]" {docker_image0}
pulumi config set --path "docker.images[1]" {docker_image1}
```
These config sections match Pulumi input types for the Proxmox provider and [our helper types](https://github.com/mikitabianko/proxmox-vm-orchestrator/blob/master/types.ts#L33-L45). We haven’t hard-coded any secrets (the API token and such are set as secure configs), making the setup reproducible and configurable per environment.