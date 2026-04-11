import { Injectable } from '@angular/core';
import { DbService } from '@mm-services/db.service';

export interface SurveyFormDefinition {
  _id: string;
  _rev?: string;
  type: string;
  form_id: string;
  title: string;
  version: string;
  definition: any; // SurveyJS JSON schema
}

@Injectable({
  providedIn: 'root'
})
export class SurveyFormService {
  constructor(private dbService: DbService) {}

  async getAvailableForms(): Promise<SurveyFormDefinition[]> {
    const db = this.dbService.get();
    const result = await db.allDocs({
      include_docs: true,
      startkey: 'surveyjs-form:',
      endkey: 'surveyjs-form:\ufff0',
    });
    return result.rows
      .map((row: any) => row.doc)
      .filter((doc: any) => doc && doc.type === 'surveyjs_form');
  }

  async getFormDefinition(formId: string): Promise<SurveyFormDefinition> {
    const db = this.dbService.get();
    return db.get(`surveyjs-form:${formId}`);
  }
}
