/**
 * Integration boundary for one-time-password delivery (SMS / WhatsApp / email).
 *
 * Sprint 1 authenticates with mobile number + password. No SMS provider
 * credentials were available, so no OTP is ever generated or sent and no OTP
 * endpoints are exposed. A future provider (e.g. MSG91, Twilio Verify, AWS SNS)
 * implements this interface and is bound to OTP_PROVIDER in AuthModule.
 * See docs/sprint-1/auth-and-security.md.
 */
export interface OtpProvider {
  readonly name: string;
  readonly configured: boolean;
  /** Sends a verification code to an E.164 phone number. */
  sendVerification(phone: string): Promise<void>;
  /** Returns true when `code` is valid for `phone`. */
  checkVerification(phone: string, code: string): Promise<boolean>;
}

export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

export class UnconfiguredOtpProvider implements OtpProvider {
  readonly name = 'unconfigured';
  readonly configured = false;

  sendVerification(): Promise<void> {
    return Promise.reject(new Error('OTP provider is not configured'));
  }

  checkVerification(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
