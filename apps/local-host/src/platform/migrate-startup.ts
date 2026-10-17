import { migrateBrandingData } from "./branding-migration";

// Complete migration before dependent modules resolve credential and repository paths.
migrateBrandingData();
