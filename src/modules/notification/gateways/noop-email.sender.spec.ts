import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../../test/support/mocks';
import { NoopEmailSender } from './noop-email.sender';

describe('NoopEmailSender', () => {
  let logger: jest.Mocked<PinoLogger>;
  let sender: NoopEmailSender;

  beforeEach(() => {
    logger = createMockLogger();
    sender = new NoopEmailSender(logger);
  });

  it('reports success so a missing mail account does not block the flow', async () => {
    await expect(
      sender.send({ to: 'ops@barakahbazaar.com.bd', subject: 'Invitation', body: 'token abc' }),
    ).resolves.toBe(true);
  });

  it('logs the recipient and subject', async () => {
    await sender.send({ to: 'ops@barakahbazaar.com.bd', subject: 'Invitation', body: 'x' });

    expect(logger.info).toHaveBeenCalledWith(
      { to: 'ops@barakahbazaar.com.bd', subject: 'Invitation' },
      'Email suppressed: EMAIL_PROVIDER is noop',
    );
  });

  it('never logs the body, which carries the invitation token', async () => {
    await sender.send({
      to: 'ops@barakahbazaar.com.bd',
      subject: 'Invitation',
      body: 'your code is super-secret-token',
    });

    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('super-secret-token');
  });
});
