
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


// mqttbus.js
// MQTT-specific message bus factory, imports mqtt and uses generic messagebus.js logic

const mqtt = require('mqtt');

function getBusClass() {
    return MqttBus;
}

class MqttBus {
    constructor(handleMessage, creds) {
        const mqttHost = process.env.MESSAGEBUS_HOST || 'localhost';
        const mqttPort = process.env.MESSAGEBUS_PORT || '1883';
        const mqttUrl = `tcp://${mqttHost}:${mqttPort}`;
        const options = {
            username: creds.username,
            password: creds.password,
            rejectUnauthorized: false
        };
        this.client = mqtt.connect(mqttUrl, options);
        this.client.on('message', handleMessage);
        this.client.on('error', (err) => {
            console.error(`Error on messagebus`, err);
        });
    }

    subscribe(topic, callback) {
        this.client.subscribe(topic, (err) => {
            if (callback) callback(err);
            if (err) {
                console.error(`Failed to subscribe to topic ${topic}:`, err);
            }
        });
    }

    unsubscribe(topic, callback) {
        this.client.unsubscribe(topic, (err) => {
            if (callback) callback(err);
            if (err) {
                console.error(`Failed to unsubscribe from topic ${topic}:`, err);
            }
        });
    }

    end(force = true, callback) {
        if (this.client && typeof this.client.end === 'function') {
            this.client.end(force, callback);
        } else if (callback) {
            callback();
        }
    }
}

module.exports = {
    getBusClass
};