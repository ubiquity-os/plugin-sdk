interface Inputs {
  stateId: unknown;
  eventName: unknown;
  eventPayload: unknown;
  authToken: unknown;
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
      ref: inputs.ref,
      command: inputs.command,
    };
    const pemContents = publicKeyPem.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", "").trim();
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
  const pemContents = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").trim();
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
