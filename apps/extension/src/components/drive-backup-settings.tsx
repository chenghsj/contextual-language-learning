import type { BackupSettings, DriveAccount, JobSummary } from "@contextual/core";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { translate, type UiLocale } from "../i18n/messages";
import { backupSettingsCopy } from "../i18n/backup-settings";
import { Button } from "./ui/button";
import { ActionFeedbackButton } from "./action-feedback-button";
import { Switch } from "./ui/switch";
import { SelectField } from "./ui/select";
import { Badge } from "./ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { IconTooltip } from "./icon-tooltip";

export type DriveBackupSettingsProps = {
  locale: UiLocale;
  backup: BackupSettings;
  accounts: DriveAccount[];
  configured: boolean;
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
  onOpenFolder(): void;
  onBackup(): void;
  onRetryFailed(): void;
};

export function DriveBackupSettings({
  locale,
  backup,
  accounts,
  configured,
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
  onOpenFolder,
  onBackup,
  onRetryFailed,
}: DriveBackupSettingsProps) {
  const ui = backupSettingsCopy(locale);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const selected = backup.accountId ?? accounts[0]?.id;
  const activeFeedback = feedback?.accountId === selected ? feedback : null;
  const records = selected ? jobs.filter(job => job.backup?.accountId === selected) : [];
  const pending = records.filter(job => ["pending", "uploading"].includes(job.backup!.status));
  const failed = records.filter(job => job.backup?.status === "failed");
  const attention = records.some(job => ["conflict", "paused"].includes(job.backup!.status));
  const last = records
    .filter(job => job.backup?.status === "backed-up")
    .map(job => job.backup!.updatedAt)
    .sort()
    .at(-1);
  const working = !!phase || pending.length > 0;
  function status(job: JobSummary) {
    switch (job.backup!.status) {
      case "backed-up":
        return ui.saved;
      case "failed":
        return ui.needsAttention;
      case "conflict":
        return ui.conflict;
      case "paused":
        return ui.paused;
      default:
        return ui.uploading;
    }
  }
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
            disabled={busy}
            onCheckedChange={onEnabled}
          />
        </label>
        {accessChecking && (
          <p role="status" className="text-xs text-muted-foreground">
            {t("driveAccessChecking")}
          </p>
        )}
        {error && (
          <p role="status" className="text-ui-body text-destructive wrap-anywhere">
            {error}
          </p>
        )}
        {!error && selected && !verified && !accessChecking && (
          <p className="text-xs text-muted-foreground">{t("driveAccessNotVerified")}</p>
        )}
        {accounts.length === 0 && (
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
        {selected && !verified && !accessChecking && error && (
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={busy}
            onClick={onRetryAccess}
          >
            {t("retryDriveAccess")}
          </Button>
        )}
        {!configured && <p className="text-xs text-muted-foreground">{t("oauthFirst")}</p>}
      </div>
      {accounts.length > 0 && (
        <section
          data-ui="backupProgress"
          className="flex min-w-0 flex-wrap items-center justify-between gap-3"
        >
          {(working || last || failed.length > 0 || attention) && (
            <div
              role="status"
              aria-live="polite"
              className="grid min-w-0 flex-1 basis-40 gap-1 text-xs leading-5 wrap-anywhere"
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
                <p className="text-muted-foreground">
                  {ui.lastBackup.replace("{time}", new Date(last).toLocaleString(locale))}
                </p>
              ) : null}
              {failed.length > 0 && (
                <p className="text-ui-body text-destructive">
                  {ui.failed.replace("{count}", String(failed.length))}
                </p>
              )}
              {attention && <p className="text-destructive">{ui.needsAttention}</p>}
            </div>
          )}
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
                {ui.history}
              </AccordionTrigger>
              <AccordionContent className="pb-2">
                <ul className="grid gap-2 pt-2 text-xs">
                  {records.map(job => (
                    <li key={job.id} className="grid min-w-0 gap-1">
                      <span className="wrap-anywhere">{job.sourceTitle}</span>
                      <span className="text-muted-foreground">{status(job)}</span>
                      {job.backup?.error && (
                        <p className="text-destructive wrap-anywhere">{job.backup.error}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      )}
    </section>
  );
}
