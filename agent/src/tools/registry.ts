import { env, isOffline } from "../env";
import type { OsintTool, ToolContext } from "./types";
import { makeWebSearchTool } from "./webSearch";
import { makeDomainRdapTool } from "./domainRdap";
import { makeCertCtTool } from "./certCt";
import { makeCorpJpTool } from "./corpJp";
import { makeCorpJpAuxTool } from "./corpJpAux";
import { makeCorpGlobalTool } from "./corpGlobal";
import { makeCorpGleifTool } from "./corpGleif";
import { makeOpenSanctionsTool } from "./openSanctions";
import { makeScreeningUsCslTool } from "./screeningUsCsl";
import { makeReverseImageTool } from "./reverseImageLinks";
import type { ToolRun } from "@hhc/shared";

export function toolContextFromEnv(webSearch?: (q: string) => Promise<ToolRun>): ToolContext {
  return {
    offline: isOffline(),
    houjinAppId: env.HHC_HOUJIN_APP_ID,
    gbizToken: env.HHC_GBIZ_INFO_API_KEY,
    openCorporatesToken: env.HHC_OPENCORPORATES_TOKEN,
    openSanctionsBaseUrl: env.HHC_OPENSANCTIONS_BASE_URL,
    openSanctionsApiKey: env.HHC_OPENSANCTIONS_API_KEY,
    tradeGovKey: env.HHC_TRADEGOV_API_KEY,
    webSearch,
  };
}

/** Assemble all OSINT tools. Tools with missing credentials are present but report unavailable. */
export function buildTools(ctx: ToolContext): OsintTool[] {
  return [
    makeWebSearchTool(ctx),
    makeDomainRdapTool(ctx),
    makeCertCtTool(ctx),
    makeCorpJpTool(ctx),
    makeCorpJpAuxTool(ctx),
    makeCorpGleifTool(ctx),
    makeCorpGlobalTool(ctx),
    makeOpenSanctionsTool(ctx, {
      name: "sanctions_opensanctions",
      dataset: "default",
      description:
        "OpenSanctions /match — consolidated sanctions / PEP / watchlist screening (F1/F2/F3). Also use it for the AFFILIATED employer / university / research-institute name to catch a listed/state-linked institution. Free for personal/non-commercial, or self-hosted yente. Matches are pending human confirmation; never assert identity or nationality.",
    }),
    makeOpenSanctionsTool(ctx, {
      name: "enduser_jp_meti",
      dataset: "jp_meti_eul",
      description:
        "Japan METI Foreign End-User List match (F1) via OpenSanctions dataset jp_meti_eul — military-diversion-of-concern entities. Pending human confirmation.",
    }),
    makeScreeningUsCslTool(ctx),
    makeReverseImageTool(ctx),
  ];
}
