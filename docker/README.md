# Node-RED Docker Setup
This folder provides two ways to run Node-RED using Docker:

1. Using the public `node-red-contrib-edgex-connector` package:

   Runs Node-RED with the publicly available connector package. Run the below snippet:
   ```bash
   docker compose -f docker-compose.public.yml up -d
   ```

   To stop the service: 
   ```bash 
   docker compose -f docker-compose.public.yml down
   ```

2. **For development purposes**:
    Run Node-RED with a local version of the `node-red-contrib-edgex-connector` package to test changes before publishing.  Run the below snippet:
   ```bash
   docker compose up -d
   ```

   To stop the service: 
   ```bash
   docker compose down
   ```

## Environment Variables

Both `docker-compose.public.yml` and `docker-compose.yml` files defines several mandatory environment variables.

You can customize these based on your deployment setup:

### Mandatory Environment Variables
The following variables must be set. If not set, the node will default to `localhost`, which will not work in Dockerized EdgeX deployments.

| Variable             | Default               | Description                                                                                             |
| -------------------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| `SERVICE_HOST`       | `node-red`            | Hostname of the Node-RED service. Used internally by EdgeX for service-to-service communication.  <br/> Must be set (e.g., `node-red`). This must also match the secret volume path.  |
| `CORE_COMMAND_HOST`  | `edgex-core-command`  | Hostname of the EdgeX Core Command service. Required for invoking device commands via Node-RED.         |
| `CORE_METADATA_HOST` | `edgex-core-metadata` | Hostname of the EdgeX Core Metadata service. Used by Node-RED to discover device profiles and metadata. |
| `MESSAGEBUS_HOST`    | `edgex-mqtt-broker`   | Hostname of the EdgeX message bus broker (MQTT). Node-RED connects here to send/receive EdgeX events.   |
| `MESSAGEBUS_PORT`    | `1883`                | Port for the MQTT message bus broker. Default is `1883` for MQTT.                                       |

### (Optional) Environment Variables

| Variable             | Default               | Description                                                                                             |
| -------------------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| `TZ`                 | `Europe/Amsterdam`    | Time zone for the container. Adjust according to your local region.                                     |
| `EDGEX_SECURITY_SECRET_STORE`  | `true`      | **Enables or disables use of the EdgeX secret store.** <br> - `true`: Retrieves credentials securely from the EdgeX secret store. <br> - `false`: Secrets are not stored securely (use only for local testing).         |
| `SECRETSTORE_HOST` | `edgex-secret-store`    | Hostname of the EdgeX secret store service. Must match the service name in your Docker network. This field is required when `EDGEX_SECURITY_SECRET_STORE` is set to `true`. The secrets volume can be mounted in Docker Compose at the path `/tmp/edgex/secrets/`.   |

## Security Considerations
This node introduces a custom endpoint for retrieving device resource information. At present, this endpoint is not secured. To mitigate this, enable global security in your Node-RED instance (see [Node-RED Security Documentation](https://nodered.org/docs/user-guide/runtime/securing-node-red)).

When EdgeX runs in **secured mode**, tokens under `/tmp/edgex/` are restricted to the `edgex` user. Running Node-RED as `edgex` may cause file permission conflicts.

#### Workaround:
- Run the following with root privileges:
```bash
sudo chmod 750 /tmp/edgex/secrets/node-red/
sudo chmod 640 /tmp/edgex/secrets/node-red/secrets-token.json
```
- Configure Docker Compose to run user as `1000:2001`.