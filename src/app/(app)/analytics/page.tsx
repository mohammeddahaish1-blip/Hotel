import { redirect } from "next/navigation";

/** The charts moved into Reports, where one period drives the figures and the charts together. */
export default function AnalyticsPage() {
  redirect("/reports");
}
