import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../../test/support/mocks';
import { createEmailSender } from './email-sender.factory';
import { NoopEmailSender } from './noop-email.sender';

describe('createEmailSender', () => {
  let logger: jest.Mocked<PinoLogger>;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('binds the noop sender when EMAIL_PROVIDER is noop', () => {
    const sender = createEmailSender(createMockConfig({ EMAIL_PROVIDER: 'noop' }), logger);

    expect(sender).toBeInstanceOf(NoopEmailSender);
  });

  it('reads EMAIL_PROVIDER rather than always binding noop', async () => {
    const sender = createEmailSender(createMockConfig({ EMAIL_PROVIDER: 'resend' }), logger);

    expect(sender).not.toBeInstanceOf(NoopEmailSender);
    await expect(sender.send({ to: 'a@b.com', subject: 's', body: 'b' })).resolves.toBe(false);
  });

  it('fails rather than reporting success for a provider with no adapter', async () => {
    const sender = createEmailSender(createMockConfig({ EMAIL_PROVIDER: 'smtp' }), logger);

    await expect(sender.send({ to: 'a@b.com', subject: 's', body: 'b' })).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it('never logs the body, which carries an invitation token', async () => {
    const sender = createEmailSender(createMockConfig({ EMAIL_PROVIDER: 'resend' }), logger);

    await sender.send({ to: 'a@b.com', subject: 'Invitation', body: 'code super-secret' });

    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('super-secret');
  });
});
