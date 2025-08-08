
/**
 * Copyright 2025 Schneider Electric
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// messagebus.js
// Generic message bus registry and logic, decoupled from specific implementations

const messageBusRegistry = {
    client: null,
    type: null, // e.g., 'mqtt', 'nats', etc.
    nodesByDevice: {},
    closinginprogress: false
};

function convertValueByType(value, type) {
    switch (type) {
        case "Int8":
        case "Int16":
        case "Int32":
        case "Int64":
        case "Uint8":
        case "Uint16":
        case "Uint32":
        case "Uint64":
            return parseInt(value, 10);
        case "Float32":
        case "Float64":
            return parseFloat(value);
        case "Bool":
        case "Boolean":
            return value === "true" || value === true;
        case "String":
        default:
            return value;
    }
}

function handleMessage(topic, message) {
    try {
        const data = JSON.parse(message.toString());
        const event = data && data.payload && data.payload.event;
        if (event && event.readings) {
            const parts = topic.split('/');
            const deviceName = parts[5];
            const nodes = messageBusRegistry.nodesByDevice[deviceName];
            if (nodes) {
                Array.from(nodes).forEach(node => {
                    const outputs = new Array(node.lenght).fill(null);
                    for (const sel of (node.selecteSourceswithrelativePos || [])) {
                        const [label, posStr] = sel.split(":");
                        let pos = parseInt(posStr, 10);
                        if (event.sourceName === label) {
                            event.readings.forEach((reading) => {
                                reading.value = convertValueByType(reading.value, reading.valueType);
                                outputs[pos] = {
                                    payload: {
                                        ...reading,
                                        eventid: event.id,
                                        sourceName: event.sourceName
                                    }
                                };
                                pos++;
                            });
                            break;
                        }
                    }
                    if (outputs.some(output => output !== null)) {
                        node.send(outputs);
                        node.status({ fill: "green", shape: "dot", text: `Last received at: ${new Date().toLocaleString()}` });
                    }                    
                });
            }
        }
    } catch (e) {
        Object.values(messageBusRegistry.nodesByDevice).flatMap(set => Array.from(set)).forEach(node => {
        node.error('Message parse error: ' + e.message);
        });
    }
}

function getFactory(type) {
    try {
        // Dynamically require the protocol-specific bus module
        const mod = require(`./${type}bus`);
        // Use getBusClass() if available, otherwise use the module directly
        const BusClass = typeof mod.getBusClass === 'function' ? mod.getBusClass() : mod;
        return (handleMessage, creds) => new BusClass(handleMessage, creds);
    } catch (e) {
        throw new Error(`No message bus implementation for type: ${type}`);
    }
}

function getMessageBusClient(type, factory, creds) {
    if (messageBusRegistry.client && messageBusRegistry.type === type) {
        return messageBusRegistry.client;
    }
    if (messageBusRegistry.client) {
        messageBusRegistry.client.end(true);
        messageBusRegistry.client = null;
    }
    const client = factory(handleMessage, creds);
    messageBusRegistry.client = client;
    messageBusRegistry.type = type;
    return client;
}

function subscribetobus(node, config, creds, type) {
    if(IsNodeSubscribed(node, config.selectDevice)) {
        return; // Already subscribed, no need to do anything
    }
    const client = getMessageBusClient(type, getFactory(type), creds);
    const device = config.selectDevice;
    if (!messageBusRegistry.nodesByDevice[device]) {
        messageBusRegistry.nodesByDevice[device] = new Set();
        const topic = `edgex/events/device/+/+/${device}/#`;
        if (typeof client.subscribe === 'function') {
            client.subscribe(topic, (err) => {
                if (err) {
                    node.status({ fill: "red", shape: "ring", text: "Subscribe Error" });
                    node.error(`${type.toUpperCase()} subscribe error: ` + err.message);
                } else {
                    node.status({ fill: "yellow", shape: "ring", text: "Subscribed" });
                    messageBusRegistry.nodesByDevice[device].add(node);
                    node.selecteSourceswithrelativePos = config.selecteSourceswithrelativePos || [];
                    node.lenght = config.resolvedResources.length;
                    // Ensure the node cleans up on close
                    node.on('close', function (removed, done) {
                        unsubscribetobus(node, device, done);       
                    }); 
                }
            });
        } else {
            node.status({ fill: "red", shape: "ring", text: "Subscribe Error" });
            node.error(`${type.toUpperCase()} does not support subscribe method`);
        }
    } else {
        messageBusRegistry.nodesByDevice[device].add(node);
        node.selecteSourceswithrelativePos = config.selecteSourceswithrelativePos || [];
        node.lenght = config.resolvedResources.length;
        node.status({ fill: "yellow", shape: "ring", text: "Subscribed" });
        // Ensure the node cleans up on close
        node.on('close', function (removed, done) {
            unsubscribetobus(node, device, done);       
        });
    }    
}

function unsubscribetobus(node, device, done) {
    const client = messageBusRegistry.client;
    if (!client || messageBusRegistry.nodesByDevice[device].size === 0) {
        if (done) done();
        return;
    }
    node.selecteSourceswithrelativePos = null;
    messageBusRegistry.nodesByDevice[device].delete(node);
    if (messageBusRegistry.nodesByDevice[device].size === 0) {
        delete messageBusRegistry.nodesByDevice[device];  
        const topic = `edgex/events/device/+/+/${device}/#`;
        if (typeof client.unsubscribe === 'function') {            
            client.unsubscribe(topic, (err) => {                
                if (err) {
                    node.status({ fill: "red", shape: "ring", text: "Unsubscribe Error" });
                }
                //Clean up irrespective error occurred or not 
                if (Object.keys(messageBusRegistry.nodesByDevice).length === 0 && !messageBusRegistry.closinginprogress) {
                    if (typeof client.end === 'function') {
                        messageBusRegistry.closinginprogress = true;                           
                        client.end(true, (err) => {
                            messageBusRegistry.closinginprogress = false;
                            if (err) {
                                node.status({ fill: "red", shape: "ring", text: `${messageBusRegistry.type.toUpperCase()} connection cannot be close` });                                                                       
                            } 
                        });

                    } else {
                        node.error(`${messageBusRegistry.type.toUpperCase()} does not support end method`);
                    }
                    messageBusRegistry.client = null;
                    messageBusRegistry.type = null;
                }
                if (done) done();
            });
            node.status({ fill: "yellow", shape: "ring", text: "Unsubscribe in progress..." });            
        } else {
            node.status({ fill: "red", shape: "ring", text: "Unsubscribe Error" });
            node.error(`${messageBusRegistry.type.toUpperCase()} does not support unsubscribe method`);
        }  
    }
    else {
        // If there are still nodes subscribed to this device, just update status
        if (done) done();
    }
    
}

function IsNodeSubscribed(node, device) {
    const nodes = messageBusRegistry.nodesByDevice[device];
    if (!nodes) return false;
    // Use reference equality for Set.has
    if (nodes.has(node)) return true;
    return false;
}

module.exports = {
    subscribetobus,
    unsubscribetobus,
    IsNodeSubscribed,
    convertValueByType
};