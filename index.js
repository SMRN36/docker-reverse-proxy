const http = require("http");
const express = require("express");
const Docker = require("dockerode");

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const managementAPI = express();

managementAPI.use(express.json());

managementAPI.post("/containers", async (req, res) => {
    const {image, tag = "latest"} = req.body;

    let imageAlreadyExists = false;
    const images = await docker.listImages();
    for(const systemImage of images){
        for(const systemTag of systemImage.RepoTags){
            if(systemTag === `${image}:${tag}`){
                imageAlreadyExists = true;
                break;
            }
        }
        if(imageAlreadyExists) break;
    }
    if(!imageAlreadyExists){
        console.log(`Pulling Image: ${image}:${tag}`);
        await docker.pull(`${image}:${tag}`);
    }

    const container = await docker.createContainer({
        Image: `${image}:${tag}`,
        Tty: false,
        HostConfig: {
            AutoRemove: true,
        },
    });

    await container.start();

    return res.json({
        status: "success",
        container: `${(await container.inspect()).Name}.localhost`,
    });
});

managementAPI.listen(8080, () => 
    console.log('Management API is running on PORT 8080')
);