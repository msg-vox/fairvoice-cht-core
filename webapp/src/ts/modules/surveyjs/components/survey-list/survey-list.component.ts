import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';

import { SurveyFormService, SurveyFormDefinition } from '../../services/survey-form.service';
import { GlobalActions } from '@mm-actions/global';

@Component({
  standalone: true,
  selector: 'app-survey-list',
  templateUrl: './survey-list.component.html',
  styleUrls: ['./survey-list.component.scss'],
  imports: [CommonModule, TranslateModule]
})
export class SurveyListComponent implements OnInit {
  forms: SurveyFormDefinition[] = [];
  loading = true;
  private globalActions: GlobalActions;

  constructor(
    private router: Router,
    private store: Store,
    private surveyFormService: SurveyFormService,
  ) {
    this.globalActions = new GlobalActions(store);
  }

  async ngOnInit(): Promise<void> {
    this.globalActions.setTitle('Surveys');
    try {
      this.forms = await this.surveyFormService.getAvailableForms();
    } catch (err) {
      console.error('[SurveyJS] Load error:', err);
    } finally {
      this.loading = false;
    }
  }

  openSurvey(formId: string): void {
    this.router.navigate(['/surveys', formId]);
  }
}
