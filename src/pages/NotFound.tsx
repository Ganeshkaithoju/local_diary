import { motion } from "framer-motion";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen bg-background text-foreground"
    >
      <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
          <BookOpen className="size-6" />
        </div>
        <p className="meta-label mt-6">error 404 · page_not_found</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          This page isn&apos;t in the book
        </h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          The address you followed doesn&apos;t exist in Local Diary Core. Head
          back and pick up where you left off.
        </p>
        <Button className="mt-6 gap-1.5 font-mono" asChild>
          <Link to="/">return_home</Link>
        </Button>
      </div>
    </motion.div>
  );
}
