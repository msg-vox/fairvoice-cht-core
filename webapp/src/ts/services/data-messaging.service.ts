import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { v7 as uuid } from 'uuid';
import { DATA_MESSAGE_TEXT_LIMIT, DOC_TYPES, PREFIXES } from '@medic/constants';
import { SessionService } from '@mm-services/session.service';

export type DataMessage = Readonly<{
  _id: string;
  type: 'data_message';
  sender_id: string;
  recipient_id: string;
  text: string;
  created_at: number;
}>;

type UploadResult = { id: string; status: 'accepted' } | { id: string; status: 'failed'; error: unknown };

@Injectable({ providedIn: 'root' })
export class DataMessagingService {
  constructor(private http: HttpClient, private session: SessionService) {}

  compose(recipientId: string, text: string): DataMessage {
    if (text.length > DATA_MESSAGE_TEXT_LIMIT * 2 || !text.trim() ||
        Array.from(text).length > DATA_MESSAGE_TEXT_LIMIT) {
      throw new Error('Invalid data message text');
    }
    const username = this.session.userCtx()?.name;
    if (!username) {
      throw new Error('A signed-in account is required to compose a data message');
    }
    return {
      _id: PREFIXES.DATA_MESSAGE + uuid(),
      type: DOC_TYPES.DATA_MESSAGE,
      sender_id: PREFIXES.COUCH_USER + username,
      recipient_id: recipientId,
      text,
      created_at: Date.now(),
    };
  }

  async send(message: DataMessage): Promise<{ id: string }> {
    const response = await firstValueFrom(this.http.post<{ id: string }>('/api/v1/data-messaging/messages', message, {
      headers: { Accept: 'application/json' },
    }));
    if (response?.id !== message._id) {
      throw new Error('The server response did not confirm the data message ID');
    }
    return response;
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
