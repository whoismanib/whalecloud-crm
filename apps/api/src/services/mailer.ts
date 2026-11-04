/** Pluggable email transport (ADM-11). Phase 2 ships `console` and `none`; SMTP plugs in here. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface MailTransport {
  send(msg: MailMessage): Promise<void>;
}

export const consoleTransport: MailTransport = {
  async send(msg) {
    console.info(`[mail] to=${msg.to} subject="${msg.subject}" ${msg.text}`);
  },
};
export const noneTransport: MailTransport = { async send() {} };

export function createMailer(driver: string | undefined): MailTransport {
  return driver === 'console' ? consoleTransport : noneTransport;
}
