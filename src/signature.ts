import { EmitterWebhookEvent, EmitterWebhookEventName } from "@octokit/webhooks";
import { CommandCall } from "./types/command";
import { compressString } from "./helpers/compression";

export class PluginInput<T extends EmitterWebhookEventName = EmitterWebhookEventName> {
  private _privateKey: string;
  public stateId: string;
  public eventName: T;
  public eventPayload: EmitterWebhookEvent<T>["payload"];
  public settings: unknown;
  public authToken: string;
  public ubiquityKernelToken?: string;
  public ref: string;
  public command: CommandCall;

  constructor(
    privateKey: string,
    stateId: string,
    eventName: T,
    eventPayload: EmitterWebhookEvent<T>["payload"],
    settings: unknown,
    authToken: string,
    ref: string,
    command: CommandCall,
    ubiquityKernelToken?: string
  ) {
    this._privateKey = privateKey;
    this.stateId = stateId;
    this.eventName = eventName;
    this.eventPayload = eventPayload;
    this.settings = settings;
    this.authToken = authToken;
    this.ubiquityKernelToken = ubiquityKernelToken;
    this.ref = ref;
    this.command = command;
  }

  public async getInputs() {
    const inputs = {
      stateId: this.stateId,
      eventName: this.eventName,
      eventPayload: compressString(JSON.stringify(this.eventPayload)),
      settings: JSON.stringify(this.settings),
      authToken: this.authToken,
      ubiquityKernelToken: this.ubiquityKernelToken,
      ref: this.ref,
      command: JSON.stringify(this.command),
    };
    const signature = await signPayload(JSON.stringify(inputs), this._privateKey);
    return {
      ...inputs,
      signature,
    };
  }
}

interface Inputs {
  stateId: unknown;
  eventName: unknown;
  eventPayload: unknown;
  authToken: unknown;
  ubiquityKernelToken?: unknown;
  settings: unknown;
  ref: unknown;
  command: unknown;
}

export async function verifySignature(publicKeyPem: string, inputs: Inputs, signature: string) {
  try {
    const inputsOrdered = {
      stateId: inputs.stateId,
      eventName: inputs.eventName,
      eventPayload: inputs.eventPayload,
      settings: inputs.settings,
      authToken: inputs.authToken,
      ubiquityKernelToken: inputs.ubiquityKernelToken,
      ref: inputs.ref,
      command: inputs.command,
    };
    const pemContents = publicKeyPem.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", "").replace(/\s+/g, "");
    const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

    const publicKey = await crypto.subtle.importKey(
      "spki",
      binaryDer,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      true,
      ["verify"]
    );

    const signatureArray = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    const dataArray = new TextEncoder().encode(JSON.stringify(inputsOrdered));

    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signatureArray, dataArray);
  } catch (error) {
    console.error(error);
    return false;
  }
}

async function importRsaPrivateKey(pem: string) {
  // eslint-disable-next-line @ubiquity-os/no-empty-strings
  const pemContents = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s+/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  return await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer as ArrayBuffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    true,
    ["sign"]
  );
}

export async function signPayload(payload: string, privateKey: string) {
  const data = new TextEncoder().encode(payload);
  const _privateKey = await importRsaPrivateKey(privateKey);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", _privateKey, data);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
