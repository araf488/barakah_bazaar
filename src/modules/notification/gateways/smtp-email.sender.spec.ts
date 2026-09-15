import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../../test/support/mocks';
import { SmtpEmailSender } from './smtp-email.sender';

const sendMail = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: (...args: unknown[]) => sendMail(...args) })),
}));

const smtpConfig = {
  EMAIL_FROM: 'no-reply@barakahbazaar.com.bd',
  EMAIL_FROM_NAME: 'Barakah Bazaar',
  EMAIL_SMTP_HOST: 'smtp-relay.brevo.com',
  EMAIL_SMTP_PORT: 587,
  EMAIL_SMTP_USER: 'smtp-user',
  // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a fixture value, not a credential
  EMAIL_SMTP_PASSWORD: 'smtp-password',
  EMAIL_SMTP_SECURE: false,
};

describe('SmtpEmailSender', () => {
  let logger: jest.Mocked<PinoLogger>;
  let sender: SmtpEmailSender;

  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue({ accepted: ['shopper@example.com'] });
    logger = createMockLogger();
    sender = new SmtpEmailSender(createMockConfig(smtpConfig), logger);
  });

  it('reports success when the relay accepts the message', async () => {
    await expect(
      sender.send({ to: 'shopper@example.com', subject: 'Hello', body: 'text' }),
    ).resolves.toBe(true);
  });

  it('sends the display name beside the address, so the relay does not show a bare address', async () => {
    await sender.send({ to: 'shopper@example.com', subject: 'Hello', body: 'text' });

    expect(sendMail.mock.calls[0][0]).toMatchObject({
      from: '"Barakah Bazaar" <no-reply@barakahbazaar.com.bd>',
      to: 'shopper@example.com',
      subject: 'Hello',
      text: 'text',
    });
  });

  it('sends the HTML alternative when one is supplied', async () => {
    await sender.send({
      to: 'shopper@example.com',
      subject: 'Hello',
      body: 'text',
      html: '<p>text</p>',
    });

    expect(sendMail.mock.calls[0][0]).toMatchObject({ html: '<p>text</p>' });
  });

  it('omits html entirely when none is supplied, rather than sending an empty part', async () => {
    await sender.send({ to: 'shopper@example.com', subject: 'Hello', body: 'text' });

    expect(sendMail.mock.calls[0][0]).not.toHaveProperty('html');
  });

  it('reports failure rather than throwing when the relay rejects the message', async () => {
    sendMail.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      sender.send({ to: 'shopper@example.com', subject: 'Hello', body: 'text' }),
    ).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it('never logs the body, which may carry a verification credential', async () => {
    sendMail.mockRejectedValue(new Error('boom'));

    await sender.send({
      to: 'shopper@example.com',
      subject: 'Verify',
      body: 'your code is 481920',
    });

    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('481920');
  });

  it('builds one transport and reuses it across sends', async () => {
    const nodemailer: { createTransport: jest.Mock } = jest.requireMock('nodemailer');
    nodemailer.createTransport.mockClear();

    await sender.send({ to: 'a@example.com', subject: 's', body: 'b' });
    await sender.send({ to: 'b@example.com', subject: 's', body: 'b' });

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
  });
});
