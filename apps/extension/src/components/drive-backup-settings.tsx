import { useEffect, useState } from "react";
import type { BackupSettings, DriveAccount, JobSummary } from "@contextual/core";
import {
  Archive,
  CircleCheck,
  Clock3,
  TriangleAlert,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";
import { translate, type UiLocale } from "../i18n/messages";
import { libraryNoticeCopy } from "../i18n/library-notice";
import { backupSettingsCopy } from "../i18n/backup-settings";
import { Button } from "./ui/button";
import { ActionFeedbackButton } from "./action-feedback-button";
import { Switch } from "./ui/switch";
import { SelectField } from "./ui/select";
import { Badge } from "./ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { IconTooltip } from "./icon-tooltip";
import { isRetiredBackup } from "../lib/backup-feedback";

export type DriveBackupSettingsProps = {
  locale: UiLocale;
  backup: BackupSettings;
  accounts: DriveAccount[];
  configured: boolean | null;
  accountsLoading?: boolean;
  accountsError?: string;
  onRetryAccounts?(): void;
  verified: boolean;
  accessChecking: boolean;
  busy: boolean;
  error: string;
  folderUrl: string | null;
  jobs: JobSummary[];
  phase: "checking" | "uploading" | null;
  feedback?: { accountId: string; action: "backup" | "retry"; success: boolean } | null;
  onEnabled(enabled: boolean): void;
  onAccount(accountId: string): void;
  onConnect(): void;
  onDisconnect(accountId: string): void;
  onRetryAccess(): void;
  onReconnect?(): void;
  onOpenFolder(): void;
  onBackup(): void;
  onRetryFailed(): void;
};

export function DriveBackupSettings({
  locale,
  backup,
  accounts,
  configured,
  accountsLoading = false,
  accountsError = "",
  onRetryAccounts,
  verified,
  accessChecking,
  busy,
  error,
  folderUrl,
  jobs,
  phase,
  feedback = null,
  onEnabled,
  onAccount,
  onConnect,
  onDisconnect,
  onRetryAccess,
  onReconnect,
  onOpenFolder,
  onBackup,
  onRetryFailed,
}: DriveBackupSettingsProps) {
  const ui = backupSettingsCopy(locale);
  const notice = libraryNoticeCopy(locale);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const authExpired = /\binvalid_(?:grant|token)\b/i.test(error);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const selected = backup.accountId ?? accounts[0]?.id;
  useEffect(() => setDetailsOpen(false), [error, selected]);
  const activeFeedback = feedback?.accountId === selected ? feedback : null;
  const records = selected
    ? jobs
        .filter(job => job.backup?.accountId === selected)
        .sort((a, b) => b.backup!.updatedAt.localeCompare(a.backup!.updatedAt))
    : [];
  const currentRecords = records.filter(job => !isRetiredBackup(job));
  const retiredRecords = records.filter(isRetiredBackup);
  const pending = records.filter(job => ["pending", "uploading"].includes(job.backup!.status));
  const failed = currentRecords.filter(job => job.backup?.status === "failed");
  const attention = records.some(job => ["conflict", "paused"].includes(job.backup!.status));
  const last = records
    .filter(job => job.backup?.status === "backed-up")
    .map(job => job.backup!.updatedAt)
    .sort()
    .at(-1);
  const working = !!phase || pending.length > 0;
  return (
    <section data-ui="driveBackup" className="grid min-w-0 gap-4 border-t border-border pt-6">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-ui-heading font-semibold">Google Drive</h3>
        <IconTooltip label={ui.openFolder}>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={ui.openFolder}
            disabled={!folderUrl}
            onClick={onOpenFolder}
          >
            <ExternalLink className="size-4" aria-hidden="true" />
          </Button>
        </IconTooltip>
      </header>
      <div className="grid min-w-0 gap-2" data-ui="backupPreferences">
        {accounts.length > 0 && (
          <div className="grid min-w-0 gap-2">
            <p className="text-xs text-muted-foreground">{t("backupAccount")}</p>
            {accounts.length === 1 ? (
              <div
                id="drive-backup-account"
                className="flex min-w-0 items-center justify-between gap-2 text-sm"
              >
                <span className="min-w-0 wrap-anywhere">{accounts[0].email}</span>
                {verified && <Badge>{t("driveConnectedStatus")}</Badge>}
              </div>
            ) : (
              <SelectField
                id="drive-backup-account"
                ariaLabel={t("backupAccount")}
                value={selected!}
                onValueChange={onAccount}
                options={accounts.map(account => ({ value: account.id, label: account.email }))}
              />
            )}
          </div>
        )}
        <label className="flex items-center justify-between gap-3 text-xs leading-5">
          <span>{ui.automatic}</span>
          <Switch
            checked={backup.enabled}
            aria-label={ui.automatic}
            disabled={busy || accountsLoading || !!accountsError}
            onCheckedChange={onEnabled}
          />
        </label>
        {!accountsLoading && !accountsError && accessChecking && (
          <p role="status" className="text-xs text-muted-foreground">
            {t("driveAccessChecking")}
          </p>
        )}
        {!accountsLoading && !accountsError && error && (
          <div className="grid min-w-0 gap-1">
            <p role="status" className="text-ui-body text-destructive wrap-anywhere">
              {authExpired ? notice.authDescription : error}
            </p>
            {authExpired && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto min-h-0 justify-self-start px-0 py-1 text-xs text-muted-foreground"
                  aria-expanded={detailsOpen}
                  onClick={() => setDetailsOpen(value => !value)}
                >
                  {detailsOpen ? notice.hideDetails : notice.details}
                </Button>
                {detailsOpen && (
                  <p className="text-xs text-muted-foreground wrap-anywhere">{error}</p>
                )}
              </>
            )}
          </div>
        )}
        {!accountsLoading &&
          !accountsError &&
          !error &&
          selected &&
          !verified &&
          !accessChecking && (
            <p className="text-xs text-muted-foreground">{t("driveAccessNotVerified")}</p>
          )}
        {accountsLoading && (
          <p role="status" className="text-xs text-muted-foreground">
            {ui.accountsLoading}
          </p>
        )}
        {!accountsLoading && accountsError && (
          <div className="grid gap-2">
            <p role="status" className="text-ui-body text-destructive wrap-anywhere">
              {accountsError}
            </p>
            {onRetryAccounts && (
              <Button
                variant="outline"
                size="sm"
                className="justify-self-start"
                disabled={busy}
                onClick={onRetryAccounts}
              >
                {t("retryDriveAccess")}
              </Button>
            )}
          </div>
        )}
        {accounts.length === 0 && !accountsLoading && !accountsError && (
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={busy || !configured}
            onClick={onConnect}
          >
            {t("connectGoogle")}
          </Button>
        )}
        {!accountsLoading && !accountsError && selected && !verified && !accessChecking && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              disabled={busy}
              onClick={onRetryAccess}
            >
              {t("retryDriveAccess")}
            </Button>
            {onReconnect && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !configured || accountsLoading || !!accountsError}
                onClick={onReconnect}
              >
                {ui.reconnect}
              </Button>
            )}
          </div>
        )}
        {configured === false && !accountsLoading && !accountsError && (
          <p className="text-ui-body text-muted-foreground">{t("oauthFirst")}</p>
        )}
      </div>
      {accounts.length > 0 && (verified || working || last || failed.length > 0 || attention) && (
        <section
          data-ui="backupProgress"
          className="flex min-w-0 flex-wrap items-center justify-between gap-3"
        >
          {(working || last || failed.length > 0 || attention) && (
            <div
              role="status"
              aria-live="polite"
              className="grid min-w-0 flex-1 basis-40 gap-1 text-ui-body wrap-anywhere"
            >
              {working ? (
                <p className="flex items-center gap-2">
                  <LoaderCircle
                    className="size-3 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  <span>
                    {phase === "checking" ? ui.preparing : ui.uploading}
                    {pending.length > 0
                      ? ` · ${ui.pending.replace("{count}", String(pending.length))}`
                      : ""}
                  </span>
                </p>
              ) : last ? (
                <p className="text-ui-label leading-relaxed text-muted-foreground">
                  {ui.lastBackup.replace("{time}", new Date(last).toLocaleString(locale))}
                </p>
              ) : null}
              {failed.length > 0 && (
                <p className="text-ui-body text-destructive">
                  {ui.failed.replace("{count}", String(failed.length))}
                </p>
              )}
              {attention && <p className="text-ui-body text-destructive">{ui.needsAttention}</p>}
            </div>
          )}
          {verified && (
            <div className="flex flex-wrap gap-2">
              <ActionFeedbackButton
                label={t("backupExisting")}
                busyLabel={ui.buttonBusy}
                successLabel={ui.buttonSuccess}
                data-ui="backup-existing-button"
                busy={!!phase && activeFeedback?.action === "backup"}
                success={!!activeFeedback?.success && activeFeedback.action === "backup"}
                disabled={busy || working || !verified}
                onClick={onBackup}
              />
              {(failed.length > 0 ||
                (activeFeedback?.action === "retry" && (!!phase || activeFeedback.success))) && (
                <ActionFeedbackButton
                  label={ui.retryFailed}
                  busyLabel={ui.buttonBusy}
                  successLabel={ui.buttonSuccess}
                  data-ui="backup-retry-button"
                  busy={!!phase && activeFeedback?.action === "retry"}
                  success={!!activeFeedback?.success && activeFeedback.action === "retry"}
                  disabled={busy || working || !verified || failed.length === 0}
                  onClick={onRetryFailed}
                />
              )}
            </div>
          )}
        </section>
      )}
      {accounts.length > 0 && (
        <Accordion type="multiple" className="border-t border-border pt-2" data-ui="backupDetails">
          <AccordionItem value="accounts" className="border-0" data-ui="driveAccountsAdvanced">
            <AccordionTrigger className="gap-2 py-2 text-xs text-muted-foreground hover:text-foreground">
              {t("manageDrive")} · {accounts.length}
            </AccordionTrigger>
            <AccordionContent className="pb-2">
              <div className="grid min-w-0 gap-2 pt-2">
                {accounts.map(account => (
                  <div
                    key={account.id}
                    className="flex min-w-0 items-start justify-between gap-2 text-xs"
                  >
                    <div className="grid min-w-0 gap-1 py-1.5">
                      <span className="wrap-anywhere">{account.email}</span>
                      {account.id === selected && (
                        <span className="text-muted-foreground" data-ui="drive-account-current">
                          {ui.selectedAccount}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onDisconnect(account.id)}
                    >
                      {t("disconnectGoogle")}
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  disabled={busy || !configured}
                  onClick={onConnect}
                >
                  {t("connectAnother")}
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>
          {records.length > 0 && (
            <AccordionItem value="history" className="border-0">
              <AccordionTrigger className="gap-2 py-2 text-xs text-muted-foreground hover:text-foreground">
                {ui.history} · {records.length}
              </AccordionTrigger>
              <AccordionContent className="pb-2">
                <ul className="min-w-0" data-ui="backup-history-current">
                  {currentRecords.map(job => (
                    <BackupHistoryRow key={job.id} job={job} locale={locale} />
                  ))}
                </ul>
                {retiredRecords.length > 0 && (
                  <Accordion type="multiple" className="mt-2">
                    <AccordionItem value="retired" className="border-0">
                      <AccordionTrigger className="gap-2 py-2 text-xs text-muted-foreground hover:text-foreground">
                        {ui.retiredGroup.replace("{count}", String(retiredRecords.length))}
                      </AccordionTrigger>
                      <AccordionContent className="pb-0">
                        <ul className="min-w-0" data-ui="backup-history-retired">
                          {retiredRecords.map(job => (
                            <BackupHistoryRow key={job.id} job={job} locale={locale} />
                          ))}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      )}
    </section>
  );
}

function BackupHistoryRow({ job, locale }: { job: JobSummary; locale: UiLocale }) {
  const ui = backupSettingsCopy(locale),
    notice = libraryNoticeCopy(locale);
  const [expanded, setExpanded] = useState(false);
  const retired = isRetiredBackup(job),
    status = job.backup!.status;
  const Icon = retired
    ? Archive
    : status === "backed-up"
      ? CircleCheck
      : status === "uploading"
        ? LoaderCircle
        : status === "pending"
          ? Clock3
          : TriangleAlert;
  const label = retired
    ? ui.retired
    : status === "backed-up"
      ? ui.saved
      : status === "pending"
        ? ui.queued
        : status === "uploading"
          ? ui.uploading
          : status === "conflict"
            ? ui.conflict
            : status === "paused"
              ? ui.paused
              : ui.needsAttention;
  const failed = !retired && ["failed", "conflict"].includes(status);
  return (
    <li
      className="flex min-w-0 items-start gap-2.5 border-b border-border py-3 last:border-0"
      data-ui="backup-history-row"
    >
      <Icon
        aria-hidden="true"
        className={
          "mt-0.5 size-4 shrink-0 " +
          (failed ? "text-destructive" : retired ? "text-muted-foreground" : "text-primary")
        }
      />
      <div className="grid min-w-0 flex-1 gap-1">
        <p
          className="line-clamp-2 text-ui-heading font-semibold wrap-anywhere"
          title={job.sourceTitle}
        >
          {job.sourceTitle}
        </p>
        <p
          className={
            failed
              ? "text-ui-body text-destructive"
              : "text-ui-label leading-relaxed text-muted-foreground"
          }
        >
          {label}
        </p>
        {!retired && job.backup?.error && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto min-h-0 justify-self-start px-0 py-1 text-xs text-muted-foreground"
              aria-expanded={expanded}
              onClick={() => setExpanded(value => !value)}
            >
              {expanded ? notice.hideDetails : notice.details}
            </Button>
            {expanded && (
              <p className="text-xs leading-5 text-muted-foreground wrap-anywhere">
                {job.backup.error}
              </p>
            )}
          </>
        )}
      </div>
    </li>
  );
}
