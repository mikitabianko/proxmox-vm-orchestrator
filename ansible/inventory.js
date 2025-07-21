export default function(ctx) {
    const hosts = {};

    ctx.hostsCfg.forEach(({ name, ip, username, password }) => {
        hosts[name] = { 
            ansible_host: ip,
            ansible_user: username,
            ansible_password: password
        };
    });

    return {
        all: {
	        vars: {
                docker_images: ctx.dockerCfg.images,
            },
            hosts: hosts
        }
    }
}