
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

const axios = require('axios');
const vault = require('./vault');
const { subscribetobus, unsubscribetobus,IsNodeSubscribed,convertValueByType } = require('./messagebus');

const corecommandHost = process.env.CORE_COMMAND_HOST || 'localhost';
const coremetadataHost = process.env.CORE_METADATA_HOST || 'localhost';
const coremetadaturl = `http://${coremetadataHost}:59881/api/v3/`
const corecommandurl = `http://${corecommandHost}:59882/api/v3/device/name/`;


module.exports = function(RED) {
    function Edgex_NodeNode(config) {
      RED.nodes.createNode(this,config);
      var node = this; 

      //Clean node status
      if (config.selectReadWrite === 'Read') {
        node.status({fill:"grey", shape:"ring", text:"Read ready"});      
      }
      else if (config.selectReadWrite === 'Write') {
        node.status({fill:"grey", shape:"ring", text:"Write ready"});
      }
      else if (config.selectReadWrite === 'Subscribe') {
        node.status({fill:"grey", shape:"ring", text:"Unsubscribed"});
      }

      node.on('input', async function(msg) {
        try {
            const token = await vault.getJwt();
            
            if (config.selectReadWrite === 'Read') {
              node.status({fill:"green", shape:"dot", text:"Reading"});
              const outputs = new Array(config.resolvedResources.length).fill(null);
              await Promise.all(
                (config.selecteSourceswithrelativePos || []).map(async (src, idx) => {
                  const label = typeof src === "string" ? src.split(":")[0] : src;
                  const pos = typeof src === "string" ? src.split(":")[1] : src;
                  const url = corecommandurl + config.selectDevice + '/' + label;
                  try {
                    const response = await axios({
                      method: 'get',
                      url: url,
                      headers: {
                        'Authorization': `Bearer ${token}`
                      },
                      timeout: 10000 // Timeout of 10 seconds
                    });

                    let outputIdx = pos;
                    if (response.data && response.data.event && response.data.event.readings && response.data.event.readings.length >= 1) {
                        response.data.event.readings.forEach((reading) => {
                          reading.value=convertValueByType(reading.value, reading.valueType);
                          outputs[outputIdx] = {                              
                              payload: {
                                ...reading,
                                eventid: response.data.event.id,
                                sourceName: response.data.event.sourceName
                              }
                            };
                          outputIdx++;
                        });
                      } else {
                        node.status({fill:"red", shape:"ring", text:"Invalid Data"});
                        node.error('Invalid response data for ' + label);
                      }
                    } catch (error) {
                      node.status({fill:"red", shape:"ring", text:"Read Error"});
                      node.error(error.message);
                    }
                  })
                );
                                    
                if (outputs.some(output => output !== null)) {
                  node.send(outputs);
                  node.status({fill:"grey", shape:"ring", text:"Read Finished"});       
                }                     
            }

            else if (config.selectReadWrite === 'Write') {
              node.status({fill:"green", shape:"dot", text:"Write"});
              const label = typeof config.selecteSourceswithrelativePos[0] === "string" ? config.selecteSourceswithrelativePos[0].split(":")[0] : config.selecteSourceswithrelativePos[0];
              var url = corecommandurl + config.selectDevice + '/' + label;
              const response = await axios.put(url, msg.payload, {
                  headers: {
                      'Authorization': `Bearer ${token}`
                  }
              });
              msg.payload = response.data;
              node.send(msg);
              node.status({fill:"grey", shape:"ring", text:"Write Finished"});
            }

            else if (config.selectReadWrite === 'Subscribe') {
              if (IsNodeSubscribed(node, config.selectDevice)) {
                  unsubscribetobus(node, config.selectDevice, () => {
                  node.status({fill:"yellow", shape:"ring", text:"Unsubscribed"});
                  });
                  return;
              }
              const creds = await vault.getMessageBusCredentials();
              // Determine protocol type, default to 'mqtt' if not specified
              const type = config.busType || 'mqtt';              
              subscribetobus(node, config, creds, type);
            }            
            else {
                node.error('Invalid Selection');
            } 
                  
          } catch (error) {
            node.status({fill:"red", shape:"ring", text:error.toString()});
            node.error(error.toString());
          }
      });
    }

    // Custom HTTP endpoint for deviceResourceMap
    RED.httpAdmin.get('/edgex/deviceResourceMap', async function(req, res) {
        try {
            //const vault = require('./vault');
            const token = await vault.getJwt();           

            // Fetch all devices
            const devicesResp = await axios.get(
                coremetadaturl + 'device/all',
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            const devices = devicesResp.data.devices || [];

            // Fetch all profiles
            const profilesResp = await axios.get(
                coremetadaturl + 'deviceprofile/all',
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            const profiles = profilesResp.data.profiles || [];

            // Build a map of profileName -> profile object
            const profileMap = {};
            profiles.forEach(profile => {
                profileMap[profile.name] = profile;
            });

            // Build deviceResourceMap: deviceName -> { resourceName: [resource details] }
            const deviceResourceMap = {};
            devices.forEach(device => {
                const profile = profileMap[device.profileName];
                if (profile) {
                    const entry = {};

                    // Add device commands
                    if (profile.deviceCommands) {
                        profile.deviceCommands.forEach(cmd => {
                            const resources = (cmd.resourceOperations || []).map(op => op.deviceResource);
                            // Find readWrite for the first resource (or default to "R")
                            let rw = cmd.readWrite || 'R';
                            entry[`${cmd.name}:${rw}`] = resources;
                        });
                    }

                    // Add device resources
                    if (profile.deviceResources) {
                        profile.deviceResources.forEach(res => {
                            entry[`${res.name}:${res.properties.readWrite}`] = [res.name];
                        });
                    }

                    deviceResourceMap[device.name] = entry;
                }
            });

            res.json(deviceResourceMap);
        } catch (err) {
            console.error('Error fetching device resource map:', err);           
            res.status(500).json({ error: err.message });
        }
    });

    RED.nodes.registerType("Edgex_Node",Edgex_NodeNode);
}