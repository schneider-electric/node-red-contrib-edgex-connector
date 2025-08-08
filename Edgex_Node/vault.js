
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

const fs = require('fs');
const axios = require('axios');

const vaultHeader = 'X-Vault-Token';
// Use SERVICE_HOST env variable or fallback to 'edgex-node-generator'
const serviceHost = process.env.SERVICE_HOST;

const jwtEndpoint = `/identity/oidc/token/${serviceHost}`;
const vaultTokenLookupEndpoint = '/auth/token/lookup-self';
const vaultTokenRenewEndpoint = '/auth/token/renew-self';
const msgbuscred = `/secret/edgex/${serviceHost}/message-bus`;

class VaultHandler {
  constructor(retryLimit) {
    this.host = (process.env.SECRETSTORE_HOST || 'localhost');
    this.port = 8200;
    this.secretPath = `/tmp/edgex/secrets/${serviceHost}/secrets-token.json`;
    this.baseURL = `http://${this.host}:${this.port}/v1`;
    this.tokenData = null;
    this.jwt = "";
    this.retryLimit = retryLimit || 5;
    this.initError = null;
    this.ready = this.init().catch(err => {
      this.initError = err;
      console.error('VaultHandler initialization failed:', err.message);
    });
  }

  async init() {
   if (!process.env.EDGEX_SECURITY_SECRET_STORE || process.env.EDGEX_SECURITY_SECRET_STORE === "false") {
      return;
    }
    // Try to read and validate the Vault token
    for (let i = 0; i < this.retryLimit; i++) {
      const t = this.getVaultTokenFromFile(this.secretPath);
      if (t instanceof Error) {
        console.error(`failed getting the token from the file: ${t.message}`);
        if (i === this.retryLimit - 1) {
          throw new Error('reached retry limit trying to read token file');
        }
        await this.sleep(2000);
        continue;
      }
      this.tokenData = t;

      try {
        await this.lookupVaultToken();
        break;
      } catch (err) {
        console.log(err.message);
        if (i === this.retryLimit - 1) {
          throw new Error('reached retry limit trying to lookup token');
        }
        await this.sleep(2000);
      }
    }

    // Obtain an initial JWT
    try {
      await this.getJwtFromVault();
    } catch (err) {
      throw new Error('Failed to get JWT from Vault: ' + err.message);
    }
    this.startRenewalLoop();
    this.startJwtRenewalLoop();
  }

  decodeJwtPayload(jwt) {
    if (!jwt) return null;
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    try {
      const payload = Buffer.from(parts[1], 'base64').toString('utf8');
      return JSON.parse(payload);
    } catch (e) {
      return null;
    }
}


startJwtRenewalLoop() {
  const scheduleRenewal = () => {
    const payload = this.decodeJwtPayload(this.jwt);
    if (!payload || !payload.exp) {
      // Fallback: try again in 10 minutes if decoding fails
      setTimeout(renew, 10 * 60 * 1000);
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = payload.exp - now;
    // Renew 60 seconds before expiry, or fallback to 10 minutes if already expired
    const renewIn = expiresIn > 60 ? (expiresIn - 60) * 1000 : 10 * 60 * 1000;
    setTimeout(renew, renewIn);
  };

  const renew = async () => {
    try {
      await this.getJwtFromVault();
      console.log('JWT renewed (scheduled refresh)');
    } catch (err) {
      console.error('JWT scheduled renewal failed:', err.message);
    }
    scheduleRenewal();
  };

  scheduleRenewal();
}

  startRenewalLoop() {
    const renewInterval = (this.tokenData.auth && this.tokenData.auth.lease_duration)
      ? Math.floor(this.tokenData.auth.lease_duration / 2)
      : 1800; // default 1800 seconds = 30 min

    setInterval(async () => {
      try {
        await this.renewVaultToken();        
        console.log('Vault token renewed successfully');
      } catch (err) {
        console.error('Vault token renewal failed:', err);
      }
    }, renewInterval * 1000);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getVaultTokenFromFile(secretPath) {
    try {
      const f = fs.readFileSync(secretPath);
      const token = JSON.parse(f);
      return token;
    } catch (err) {
      return new Error(`could not read file: ${err.message}`);
    }
  }

  getTokenValue() {
    return (
      this.tokenData?.client_token ||
      this.tokenData?.token ||
      (this.tokenData?.auth && this.tokenData.auth.client_token) ||
      (this.tokenData?.Auth && this.tokenData.Auth.Token)
    );
  }

  async lookupVaultToken() {
    const token = this.getTokenValue();
    if (!token) throw new Error('No valid Vault token available');
    const url = `${this.baseURL}${vaultTokenLookupEndpoint}`;
    try {
      const resp = await axios.get(url, {
        headers: { [vaultHeader]: token }
      });
      if (resp.status !== 200) {
        throw new Error(`could not look up token, HTTP response with status code: ${resp.status}`);
      }
    } catch (err) {
      // If token is expired, try to refresh using entityId endpoint
      if (
        err.response &&
        err.response.status === 403 &&
        this.tokenData &&
        this.tokenData.auth &&
        this.tokenData.auth.entity_id
      ) {
        try {
          const secretStoreSetupHost = process.env.SECRETSTORESETUP_HOST || "localhost";          
          const entityId = this.tokenData.auth.entity_id;
          const entityTokenUrl = `http://${secretStoreSetupHost}:59843/api/v3/token/entityId/${entityId}`; //https://docs.edgexfoundry.org/4.1/security/Ch-SecretStoreSetup/#:~:text=security%2Dsecretstore%2Dsetup-,regenerate%20token,-API%20is%20new
          const resp = await axios.put(entityTokenUrl);
          if (resp.status === 200) {
            // Update tokenData with new token
            this.tokenData = this.getVaultTokenFromFile(this.secretPath);
            console.log("Vault token refreshed using entityId endpoint.");
            return;
          } else {
            throw new Error(`Failed to refresh token using entityId endpoint, status: ${resp.status}`);
          }
        } catch (refreshErr) {
          throw new Error(`could not look up token and failed to refresh via entityId: ${refreshErr.message}`);
        }
      }
      throw new Error(`could not look up token: ${err.message}`);
    }
  }

  async renewVaultToken() {
    const token = this.getTokenValue();
    if (!token) throw new Error('No valid Vault token available');
    const url = `${this.baseURL}${vaultTokenRenewEndpoint}`;
    try {
      const resp = await axios.post(
        url,
        { increment: '1h' },
        { headers: { [vaultHeader]: token } }
      );
      if (resp.status !== 200) {
        throw new Error(`could not renew token, HTTP response with status code: ${resp.status}`);
      }
      this.tokenData = resp.data;
      console.log('renewed vault token');
    } catch (err) {
      throw new Error(`could not renew token: ${err.message}`);
    }
  }

  async getJwtFromVault() {
    const token = this.getTokenValue();
    if (!token) throw new Error('No valid Vault token available');
    const url = `${this.baseURL}${jwtEndpoint}`;
    try {
      const resp = await axios.get(url, {
        headers: { [vaultHeader]: token }
      });
      if (resp.status !== 200) {
        throw new Error(`could not get jwt, HTTP response with status code: ${resp.status}`);
      }
      this.jwt = resp.data.data.token;
      console.log('obtained a JWT from vault');
    } catch (err) {
      throw new Error(`could not get jwt: ${err.message}`);
    }
  }

  async getJwt() {
   // If initialization failed, try to re-initialize once
    if (this.initError) {
      try {
        this.initError = null;
        await this.init();
      } catch (err) {
        this.initError = err;
        return "";
      }
    } else {
      await this.ready;
    }
    if (this.initError) {
      return "";
    }
    return this.jwt;
  }

  /**
   * Fetch message-bus credentials from Vault using the current token.
   * Returns a Promise that resolves to the credentials object.
   */
  async getMessageBusCredentials() {
    await this.ready;
    if (this.initError || !process.env.EDGEX_SECURITY_SECRET_STORE || process.env.EDGEX_SECURITY_SECRET_STORE === "false") {
      return {
        username: "",
        password: "",
      };
    }
    const token = this.getTokenValue();
    if (!token) return { username: "", password: "" };
    const vaultApiUrl = `${this.baseURL}${msgbuscred}`;
    try {
      const resp = await axios.get(vaultApiUrl, {
        headers: { [vaultHeader]: token },
      });
      return resp.data.data; // { username, password, host, ... }
    } catch (err) {
      // If error, try to re-initialize and retry once
      try {
        await this.init();
        const resp = await axios.get(vaultApiUrl, {
          headers: { [vaultHeader]: this.getTokenValue() },
        });
        return resp.data.data;
      } catch (retryErr) {
        return { username: "", password: "" };
      }
    }
  }
}

// Create and export a single instance
const vaultHandlerInstance = new VaultHandler();

module.exports = vaultHandlerInstance;