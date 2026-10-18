import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateFakeLoader, TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { expect } from 'chai';
import { provideMockStore } from '@ngrx/store/testing';
import { FormatDateService } from '@mm-services/format-date.service';
import { RelativeDateService } from '@mm-services/relative-date.service';

import { CustomResourceService } from '@mm-services/custom-resource.service';
import { ContentRowListItemComponent } from '@mm-components/content-row-list-item/content-row-list-item.component';

describe('Content row inert presentation', () => {
  beforeEach(() => TestBed.configureTestingModule({
    providers: [
      provideMockStore(),
      { provide: FormatDateService, useValue: {} },
      { provide: RelativeDateService, useValue: {} },
      { provide: CustomResourceService, useValue: { getImg: () => '' } },
    ],
    imports: [
      ContentRowListItemComponent,
      RouterTestingModule,
      TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
    ],
  }));

  it('preserves default navigation and removes every navigation affordance when inert', () => {
    const fixture = TestBed.createComponent(ContentRowListItemComponent);
    fixture.componentInstance.route = ['/reports', 'report-1'];
    fixture.componentInstance.heading = 'Report heading';
    fixture.componentInstance.summary = 'Report summary';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).to.equal('/reports/report-1');
    expect(fixture.nativeElement.querySelector('input')).to.exist;

    fixture.componentRef.setInput('inert', true);
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('li');
    const anchor = row.querySelector('a');
    expect(row.classList.contains('inert')).to.be.true;
    expect(row.textContent).to.contain('Report heading');
    expect(row.textContent).to.contain('Report summary');
    expect(anchor.hasAttribute('href')).to.be.false;
    expect(anchor.tabIndex).to.equal(-1);
    expect(anchor.getAttribute('role')).to.equal('presentation');
    expect(row.querySelector('input')).to.equal(null);

    fixture.componentRef.setInput('inert', false);
    fixture.detectChanges();
    expect(anchor.getAttribute('href')).to.equal('/reports/report-1');
    expect(anchor.hasAttribute('role')).to.be.false;
  });
});
