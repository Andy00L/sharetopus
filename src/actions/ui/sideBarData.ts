import {
  ArrowDownUpIcon,
  AwardIcon,
  BookOpenIcon,
  BriefcaseIcon,
  DollarSignIcon,
  LayoutDashboardIcon,
  PercentIcon,
  PlaneIcon,
  ShieldIcon,
  TagIcon,
} from "lucide-react";

export const sideBarData = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "../../../public/icon.webp",
  },
  navMain: [
    {
      title: "All cards",
      url: "#",
      icon: LayoutDashboardIcon,
      filterValue: "",
    },
    {
      title: "Travel cards",
      url: "#",
      icon: PlaneIcon,
      filterValue: "travel",
    },
    {
      title: "No annual fee cards",
      url: "#",
      filterValue: "no-annual-fee",
      icon: TagIcon,
    },
    {
      title: "Cash back cards",
      url: "#",
      icon: DollarSignIcon,
      filterValue: "cashback",
    },
    {
      title: "Balance transfer cards",
      url: "#",
      icon: ArrowDownUpIcon,
      filterValue: "balance-transfer",
    },
    {
      title: "Student cards",
      url: "#",
      icon: BookOpenIcon,
      filterValue: "student",
    },
    {
      title: "Business cards",
      url: "#",
      icon: BriefcaseIcon,
      filterValue: "business",
    },
    {
      title: "Low interest cards",
      url: "#",
      icon: PercentIcon,
      filterValue: "low-interest",
    },
    {
      title: "Secured cards",
      url: "#",
      icon: ShieldIcon,
      filterValue: "secured",
    },
    {
      title: "Rewards cards",
      url: "#",
      icon: AwardIcon,
      filterValue: "rewards",
    },
  ],
};
