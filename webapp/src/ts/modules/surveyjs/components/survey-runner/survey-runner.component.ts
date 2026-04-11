import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Model } from 'survey-core';
import { SurveyModule } from 'survey-angular-ui';
import { Store } from '@ngrx/store';

import { SurveyFormService } from '../../services/survey-form.service';
import { SurveySubmissionService } from '../../services/survey-submission.service';
import { GlobalActions } from '@mm-actions/global';

import 'survey-core/defaultV2.min.css';

@Component({
  standalone: true,
  selector: 'app-survey-runner',
  templateUrl: './survey-runner.component.html',
  styleUrls: ['./survey-runner.component.scss'],
  imports: [CommonModule, SurveyModule]
})
export class SurveyRunnerComponent implements OnInit {
  surveyModel: Model | null = null;
  formId: string = '';
  loading: boolean = true;
  error: string | null = null;
  submitted: boolean = false;
  private globalActions: GlobalActions;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private store: Store,
    private surveyFormService: SurveyFormService,
    private surveySubmissionService: SurveySubmissionService,
  ) {
    this.globalActions = new GlobalActions(store);
  }

  async ngOnInit(): Promise<void> {
    this.formId = this.route.snapshot.paramMap.get('formId') || '';
    this.globalActions.setTitle(`Survey: ${this.formId}`);

    try {
      const formDef = await this.surveyFormService.getFormDefinition(this.formId);
      this.surveyModel = new Model(formDef.definition);
      this.surveyModel.onComplete.add(sender => this.handleSubmission(sender.data));
      this.loading = false;
    } catch (err: any) {
      this.error = `Failed to load form: ${err.message}`;
      this.loading = false;
    }
  }

  private async handleSubmission(data: any): Promise<void> {
    try {
      await this.surveySubmissionService.submitSurvey(this.formId, data);
      this.submitted = true;
      this.globalActions.setSnackbarContent('Survey submitted successfully');
      setTimeout(() => this.router.navigate(['/surveys']), 2000);
    } catch (err: any) {
      this.globalActions.setSnackbarContent('Error saving survey.');
    }
  }
}
