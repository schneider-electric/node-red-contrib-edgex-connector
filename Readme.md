
### Node-Red connector for EdgeX

This node-red node allows you to connect Node-RED flows to EdgeX Foundry devices and services (<https://github.com/edgexfoundry>). It supports **reading**, **writing**, and **subscribing** to device resources using secure credentials from EdgeX Vault. **Both Secured and unsecured mode is supported.**
This node can be useful for integrating EdgeX data into Node-RED flows, enabling custom computation, creating pipelines/workflows, automation, dashboard creation etc.

## Installation

You can search and install this node directly inside node-red using node-red palette(work in progress to add the node in node-red palette).

If node-red docker is used , then clone the directory, map the directory as a volume and exec

```bash
docker exec -it <node-red container> npm install <mapped directory of node-red-contrib-edgex-connector>
```

If node-red is installed locally then do the following:

```bash
cd ~/.node-red
git clone https://github.com/schneider-electric/node-red-contrib-edgex-connector
npm install node-red-contrib-edgex-connector
```

Then restart Node-RED. The EdgeX node will appear in the Node-RED palette.

---

#### How Input, Read, and Subscribe Modes Work

* **Read Mode:**
  When set to **Read**, the node will fetch data from the selected device resources. You can select multiple sources, and each output port will correspond to a selected resource. If a **device command** is selected then all the resources inside the command will have a corresponding output. The **output label** for each port will show the resource name. The node can be activated by an inject node.
* **Subscribe Mode:**
  In **Subscribe** mode, the node listens for events from the selected device resources via the EdgeX message bus (MQTT). If a **device command** is selected then all the resources inside the command will have a corresponding output. The **output label** for each port will show the resource name. The node can be activated by an inject node.
* **Write Mode:**
  In **Write** mode, only one source can be selected. The input port will display the resource name. The node expects `msg.payload` to be a JSON object with resource names as keys and values to write.

#### Write Operation: Input Format

* **Input Format:**
  For **Write** mode, `msg.payload` should be a JSON object where each key is a **resourceName** as defined in your device profile, and the value is the value to write.

  **Example:**

msg.payload = {
"AHU-TargetTemperature": "28.5",
"AHU-TargetBand": "4.0",
}

See the [EdgeX Core Command API documentation](https://docs.edgexfoundry.org/3.2/api/core/Ch-APICoreCommand/#put-device-by-name) for more details.

* **Output:**
The output for Write mode contains only the result of the operation (the response from EdgeX Core Command), typically indicating success or failure.

#### Sample Docker Compose Service

The node is only tested in Dockerized environments with EdgeX Foundry. To run the EdgeX service, follow the instructions in <https://github.com/edgexfoundry/edgex-compose>.

Below is a sample **docker-compose** service definition for Node-RED with EdgeX integration:

```yaml
node-red:
image: nodered/node-red
environment:
  TZ: Europe/Amsterdam
  EDGEX_SECURITY_SECRET_STORE: "true"
  SECRETSTORE_HOST: edgex-secret-store
  SERVICE_HOST: node-red
  CORE_COMMAND_HOST: edgex-core-command
  CORE_METADATA_HOST: edgex-core-metadata
  MESSAGEBUS_HOST: edgex-mqtt-broker
  MESSAGEBUS_PORT: "1883"
ports:
  - "1880:1880"
user: '1000:2001'
networks:
  edgex-network: null
volumes:
  - node-red-data:/data
  - /tmp/edgex/secrets/node-red:/tmp/edgex/secrets/node-red:ro,z
```

#### Required Environment Variables

Mandatory: SERVICE_HOST, CORE_COMMAND_HOST, CORE_METADATA_HOST, MESSAGEBUS_HOST, and MESSAGEBUS_PORT must be set. If not set, the node will default to localhost, which will not work in Dockerized EdgeX deployments.

SERVICE_HOST and the secret volume path must use the same value (e.g., node-red).

In secured mode (EDGEX_SECURITY_SECRET_STORE set to true), the node will automatically fetch the secret token from EdgeX Vault. The env SECRETSTORESETUP_HOST is also Mandatory. The secret token is stored in /tmp/edgex/secrets/<node-red-servicename>/secrets-token.json and is mounted read-only. Please refer <https://docs.edgexfoundry.org/4.1/security/Ch-Configuring-Add-On-Services/#:~:text=simpler%20form%20of-,EDGEX_ADD_KNOWN_SECRETS,-environment%20variable's%20value> to configure your node-red.

#### Secret Volume Configuration

The secret token must be mounted read-only from /tmp/edgex/secrets/node-red as shown in the compose file above.

'node-red' is the service name which must match the value of SERVICE_HOST.

#### Security Note
This node introduces a custom endpoint for retrieving device resource information, which is currently **not secured**. To mitigate this, it is recommended to enable global security for your Node-RED instance. See the [Node-RED Security Documentation](https://nodered.org/docs/user-guide/runtime/securing-node-red) for guidance. Node-level security could also be implemented using a dedicated configuration node; however, this functionality is **not yet available**.

When EdgeX is running in secured mode, the tokens in `/tmp/edgex/` are, by default, accessible only to the `edgex` user for security reasons. Running Node-RED as the `edgex` user may lead to permission issues with Node-RED files.

A recommended workaround is to grant read access to the EdgeX group (GID 2001) for the Node-RED token. This requires root privileges. Execute the following commands:

```bash
sudo chmod 750 /tmp/edgex/secrets/node-red/
sudo chmod 640 /tmp/edgex/secrets/node-red/secrets-token.json
```

Additionally, in your Docker Compose or Docker run configuration, set the user as `'1000:2001'`.

In the future, a configuration node may be provided to allow token retrieval directly from the UI.

This node has been tested only with Dockerized deployments of Node-RED and EdgeX.

#### Demo

![edgex_nodered](https://github.schneider-electric.com/SESA216434/node-red-contrib-edgex-connector/assets/8408/1f1e5bf4-82d1-4c50-b812-352bc7a70fd3)

## License
This project is licensed under the Apache License 2.0 - see the LICENSE file for details.