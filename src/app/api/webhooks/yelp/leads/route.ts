export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export {
  handleYelpWebhookGet as GET,
  handleYelpWebhookPost as POST,
} from "@/lib/yelp/webhookRoute";
