import Link from "next/link";

const SMS_NAV = [
  { href: "/sms", label: "Dashboard" },
  { href: "/sms/queue", label: "Checker queue" },
  { href: "/sms/users", label: "Users & access" },
];

export default function SmsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell page">
      <nav className="breadcrumb" aria-label="Student Management System">
        <strong>Student Management System</strong>
        {SMS_NAV.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
