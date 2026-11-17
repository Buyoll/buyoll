import { FRONTEND_URL } from './config.js';
import { DatabaseSchema } from './db.js';
import { sendSecurityEmail } from './auth_utils.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SmsMessage {
  to: string;
  body: string;
}

export interface EmailProvider {
  readonly name: string;
  sendEmail(msg: EmailMessage): Promise<void>;
}

export interface SmsProvider {
  readonly name: string;
  sendSms(msg: SmsMessage): Promise<void>;
}

function getEmailFrom(): string {
  return process.env.EMAIL_FROM || 'Buyoll <no-reply@buyoll.com>';
}

class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  constructor(private readonly apiKey: string) {}
  async sendEmail(msg: EmailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: getEmailFrom(),
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend email delivery failed (${res.status})`);
    }
  }
}

class SendGridEmailProvider implements EmailProvider {
  readonly name = 'sendgrid';
  constructor(private readonly apiKey: string) {}
  async sendEmail(msg: EmailMessage): Promise<void> {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: msg.to }] }],
        from: { email: getEmailFrom().replace(/^.*<([^>]+)>.*$/, '$1') },
        subject: msg.subject,
        content: [
          { type: 'text/plain', value: msg.text },
          ...(msg.html ? [{ type: 'text/html', value: msg.html }] : []),
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`SendGrid email delivery failed (${res.status})`);
    }
  }
}

class MailgunEmailProvider implements EmailProvider {
  readonly name = 'mailgun';
  constructor(private readonly apiKey: string, private readonly domain: string) {}
  async sendEmail(msg: EmailMessage): Promise<void> {
    const form = new URLSearchParams({
      from: getEmailFrom(),
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
    });
    if (msg.html) form.set('html', msg.html);
    const auth = Buffer.from(`api:${this.apiKey}`).toString('base64');
    const res = await fetch(`https://api.mailgun.net/v3/${this.domain}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!res.ok) {
      throw new Error(`Mailgun email delivery failed (${res.status})`);
    }
  }
}

class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  async sendEmail(msg: EmailMessage): Promise<void> {
    if (process.env.NODE_ENV !== 'production' && process.env.BUYOLL_TEST_MODE !== '1') {
      console.info(`[Buyoll Console Mailer] To: ${msg.to} | Subject: ${msg.subject}\n${msg.text}`);
    }
  }
}

class AfricasTalkingSmsProvider implements SmsProvider {
  readonly name = 'africastalking';
  constructor(
    private readonly apiKey: string,
    private readonly username: string,
    private readonly senderId?: string
  ) {}
  async sendSms(msg: SmsMessage): Promise<void> {
    const form = new URLSearchParams({
      username: this.username,
      to: msg.to,
      message: msg.body,
    });
    if (this.senderId) form.set('from', this.senderId);
    const endpoint =
      this.username === 'sandbox'
        ? 'https://api.sandbox.africastalking.com/version1/messaging'
        : 'https://api.africastalking.com/version1/messaging';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apiKey: this.apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!res.ok) {
      throw new Error(`Africa's Talking SMS delivery failed (${res.status})`);
    }
  }
}

class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  constructor(
    private readonly sid: string,
    private readonly token: string,
    private readonly fromNumber: string
  ) {}
  async sendSms(msg: SmsMessage): Promise<void> {
    const form = new URLSearchParams({
      To: msg.to,
      From: this.fromNumber,
      Body: msg.body,
    });
    const auth = Buffer.from(`${this.sid}:${this.token}`).toString('base64');
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      }
    );
    if (!res.ok) {
      throw new Error(`Twilio SMS delivery failed (${res.status})`);
    }
  }
}

class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  async sendSms(msg: SmsMessage): Promise<void> {
    if (process.env.NODE_ENV !== 'production' && process.env.BUYOLL_TEST_MODE !== '1') {
      console.info(`[Buyoll Console SMS] To: ${msg.to}\n${msg.body}`);
    }
  }
}

export function getEmailProvider(): EmailProvider {
  if (process.env.RESEND_API_KEY) {
    return new ResendEmailProvider(process.env.RESEND_API_KEY);
  }
  if (process.env.SENDGRID_API_KEY) {
    return new SendGridEmailProvider(process.env.SENDGRID_API_KEY);
  }
  if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
    return new MailgunEmailProvider(process.env.MAILGUN_API_KEY, process.env.MAILGUN_DOMAIN);
  }
  return new ConsoleEmailProvider();
}

export function getSmsProvider(): SmsProvider {
  if (process.env.AFRICASTALKING_API_KEY && process.env.AFRICASTALKING_USERNAME) {
    return new AfricasTalkingSmsProvider(
      process.env.AFRICASTALKING_API_KEY,
      process.env.AFRICASTALKING_USERNAME,
      process.env.AFRICASTALKING_SENDER_ID
    );
  }
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
    return new TwilioSmsProvider(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN,
      process.env.TWILIO_FROM_NUMBER
    );
  }
  return new ConsoleSmsProvider();
}

export async function dispatchContactNotification(params: {
  email?: string | null;
  phone?: string | null;
  preferChannel?: 'email' | 'sms';
  subject: string;
  body: string;
}): Promise<void> {
  const sendViaSms =
    (params.preferChannel === 'sms' && Boolean(params.phone)) ||
    (!params.email && Boolean(params.phone));

  if (sendViaSms && params.phone) {
    const sms = getSmsProvider();
    await sms.sendSms({ to: params.phone, body: params.body }).catch((err) => {
      console.error(`[SmsProvider:${sms.name}] Delivery warning:`, err?.message || err);
    });
    return;
  }

  if (params.email) {
    const mailer = getEmailProvider();
    await mailer
      .sendEmail({ to: params.email, subject: params.subject, text: params.body })
      .catch((err) => {
        console.error(`[EmailProvider:${mailer.name}] Delivery warning:`, err?.message || err);
      });
  }
}

export function buildResetLink(rawToken: string): string {
  const base = FRONTEND_URL || 'http://localhost:3000';
  return `${base}/?reset_token=${encodeURIComponent(rawToken)}`;
}
