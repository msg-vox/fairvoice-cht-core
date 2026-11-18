import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { v7 as uuid } from 'uuid';
import { DATA_MESSAGE_RECIPIENT_INELIGIBLE, DATA_MESSAGE_TEXT_LIMIT, DOC_TYPES, PREFIXES } from '@medic/constants';
import { SessionService } from '@mm-services/session.service';

export type DataMessage = Readonly<{
  _id: string;
  type: 'data_message';
  sender_id: string;
  recipient_id: string;
  text: string;
  created_at: number;
}>;

export type DataMessagingRecipient = Readonly<{
  account_id: string;
  display_name: string;
  role_label: string;
  place_label: string;
}>;
export type DataMessagingDirectory = readonly DataMessagingRecipient[];
export type DataMessagingPage = {
  account_id: string;
  messages: Omit<DataMessage, 'type'>[];
  directory: DataMessagingDirectory | null;
  next_since: string;
  has_more: boolean;
};

export const isValidDataMessageText = (text: string): boolean => text.length <= DATA_MESSAGE_TEXT_LIMIT * 2 &&
  !!text.trim() && Array.from(text).length <= DATA_MESSAGE_TEXT_LIMIT;

export type DataMessageRejection = 'recipient_ineligible' | 'failed';

export const getDataMessageRejection = (error: unknown): DataMessageRejection | undefined => {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 403 && error.error?.details === DATA_MESSAGE_RECIPIENT_INELIGIBLE) {
      return 'recipient_ineligible';
    }
    if (error.status === 400 || error.status === 409) {
      return 'failed';
    }
  }
};

type UploadResult = { id: string; status: 'accepted' } | { id: string; status: 'failed'; error: unknown };
const REQUEST_OPTIONS = { headers: { Accept: 'application/json' }, timeout: 30000 };

@Injectable({ providedIn: 'root' })
export class DataMessagingService {
  constructor(private http: HttpClient, private session: SessionService) {}

  accountId(): string | undefined {
    const username = this.session.userCtx()?.name;
    return username ? PREFIXES.COUCH_USER + username : undefined;
  }

  compose(recipientId: string, text: string): DataMessage {
    if (!isValidDataMessageText(text)) {
      throw new Error('Invalid data message text');
    }
    const sender_id = this.accountId();
    if (!sender_id) {
      throw new Error('A signed-in account is required to compose a data message');
    }
    return {
      _id: PREFIXES.DATA_MESSAGE + uuid(),
      type: DOC_TYPES.DATA_MESSAGE,
      sender_id,
      recipient_id: recipientId,
      text,
      created_at: Date.now(),
    };
  }

  async send(message: DataMessage): Promise<{ id: string }> {
    if (message.sender_id !== this.accountId()) {
      throw new Error('The message sender does not match the signed-in account');
    }
    const response = await firstValueFrom(
      this.http.post<{ id: string }>('/api/v1/data-messaging/messages', message, REQUEST_OPTIONS)
    );
    if (response?.id !== message._id) {
      throw new Error('The server response did not confirm the data message ID');
    }
    return response;
  }

  async getSyncPage(since?: string): Promise<DataMessagingPage> {
    const accountId = this.accountId();
    if (!accountId) {
      throw new Error('A signed-in account is required to sync data messages');
    }
    const page = await firstValueFrom(this.http.get<DataMessagingPage>('/api/v1/data-messaging/sync', {
      ...REQUEST_OPTIONS,
      ...(since && { params: { since } }),
    }));
    if (page?.account_id !== accountId || this.accountId() !== accountId) {
      throw new Error('The messaging sync response does not match the signed-in account');
    }
    if ((page.directory !== null && !Array.isArray(page.directory)) || !Array.isArray(page.messages) ||
        typeof page.next_since !== 'string' || !page.next_since || typeof page.has_more !== 'boolean' ||
        (page.has_more && since === page.next_since)) {
      throw new Error('Invalid messaging sync page');
    }
    for (const message of page.messages) {
      if (typeof message?._id !== 'string' || !message._id.startsWith(PREFIXES.DATA_MESSAGE) ||
          (message.sender_id !== accountId && message.recipient_id !== accountId)) {
        throw new Error('The downloaded message does not belong to the signed-in account');
      }
    }
    return page;
  }

  async *uploadOutbox(messages: readonly DataMessage[]): AsyncGenerator<UploadResult, void> {
    for (const message of messages) {
      try {
        const { id } = await this.send(message);
        yield { id, status: 'accepted' };
      } catch (error) {
        yield { id: message._id, status: 'failed', error };
      }
    }
  }
}
