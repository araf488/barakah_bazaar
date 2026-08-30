import { Language, OrderStatus } from '../../infra/prisma/prisma-client';
import {
  NOTIFICATION_TEMPLATES,
  NotificationTemplateId,
  ORDER_STATUS_TEMPLATES,
} from './notification.constants';

const variables = {
  orderNumber: 'BB-20260830-000042',
  recipientName: 'Rahim Uddin',
  total: '৳2,500.00',
};

describe('notification templates', () => {
  it('has a template for every order status', () => {
    for (const status of Object.values(OrderStatus)) {
      expect(ORDER_STATUS_TEMPLATES[status]).toBeDefined();
    }
  });

  it('points every status at a template that actually exists', () => {
    for (const templateId of Object.values(ORDER_STATUS_TEMPLATES)) {
      expect(NOTIFICATION_TEMPLATES[templateId]).toBeDefined();
    }
  });

  it('renders every template in both languages', () => {
    for (const [id, template] of Object.entries(NOTIFICATION_TEMPLATES)) {
      for (const language of Object.values(Language)) {
        const body = template.body[language](variables);

        expect(body.length).toBeGreaterThan(0);
        expect(body).toContain(variables.orderNumber);
        expect(`${id} ${language}`).toBeTruthy();
      }
    }
  });

  it('keeps every Bengali body inside one Unicode SMS segment', () => {
    // A Bengali SMS is UCS-2: 70 characters per segment, against 160 for Latin. A body that
    // creeps over silently costs three times as much to send.
    for (const template of Object.values(NOTIFICATION_TEMPLATES)) {
      expect(template.body[Language.BN](variables).length).toBeLessThanOrEqual(70);
    }
  });

  it('substitutes nothing a template was not given', () => {
    const rendered =
      NOTIFICATION_TEMPLATES['order.placed' as NotificationTemplateId].body[Language.EN](variables);

    expect(rendered).not.toContain('${');
    expect(rendered).not.toContain('undefined');
  });
});
