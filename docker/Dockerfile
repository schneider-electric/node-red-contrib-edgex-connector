FROM nodered/node-red:4.1

USER node-red

WORKDIR /usr/src/node-red

COPY --chown=node-red:node-red package.json ./node-red-contrib-edgex-connector/
COPY --chown=node-red:node-red Edgex_Node ./node-red-contrib-edgex-connector/Edgex_Node

RUN npm install --unsafe-perm --no-update-notifier --no-fund ./node-red-contrib-edgex-connector