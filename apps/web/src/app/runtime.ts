export type WebSession = {
  actorType: "PATIENT" | "DOCTOR" | "STAFF";
  capabilities: string[];
};

export type GatewayTransport = (url: string, init?: RequestInit) => Promise<Response>;

/** Public adapter boundary; Hưng supplies transport/session and the Identity redirect callback. */
export type WebRuntime = {
  transport: GatewayTransport;
  session?: WebSession;
  onUnauthorized: () => void;
};

export function withAuthRedirect(
  transport: GatewayTransport,
  onUnauthorized: () => void,
): GatewayTransport {
  return async (url, init) => {
    const response = await transport(url, init);
    if (response.status === 401) onUnauthorized();
    return response;
  };
}

declare global {
  interface Window {
    umcCareWebRuntime?: WebRuntime;
  }
}