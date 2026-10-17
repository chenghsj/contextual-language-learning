import { ActionFeedbackButton } from "./action-feedback-button";
import React, { type ComponentProps } from "react";

export function VideoMetadataButton(props: ComponentProps<typeof ActionFeedbackButton>) {
  return <ActionFeedbackButton {...props} data-ui="video-metadata-button" />;
}
