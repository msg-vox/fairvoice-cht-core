import { Injectable } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { DbService } from '@mm-services/db.service';
import { SessionService } from '@mm-services/session.service';
import { UserContactService } from '@mm-services/user-contact.service';

@Injectable({
  providedIn: 'root'
})
export class SurveySubmissionService {
  constructor(
    private dbService: DbService,
    private sessionService: SessionService,
    private userContactService: UserContactService,
  ) {}

  async submitSurvey(formId: string, surveyData: any): Promise<any> {
    const db = this.dbService.get();
    const userContact = await this.userContactService.get();
    const userName = this.sessionService.userCtx()?.name;

    const doc = {
      _id: uuidv4(),
      type: 'data_record',
      form: `surveyjs:${formId}`,
      content_type: 'json',
      reported_date: Date.now(),
      source: 'surveyjs',
      contact: {
        _id: userContact?._id || null,
        name: userContact?.name || userName,
        parent: userContact?.parent || null,
      },
      fields: surveyData,
      surveyjs_raw: surveyData,
      geolocation_log: [],
    };

    try {
      const response = await db.put(doc);
      console.log('[SurveyJS] Submission saved:', response.id);
      return { success: true, id: response.id, rev: response.rev };
    } catch (err) {
      console.error('[SurveyJS] Submission error:', err);
      throw err;
    }
  }
}
