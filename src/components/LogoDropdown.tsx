// simple logo dropdown component that can be used to go to the landing page or sign out for the user

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import logo from "@/assets/logo.svg";
import { useAuth } from "@/hooks/use-auth";
import { useFullScreen } from "@/diary/fullscreen";
import { Home, LogOut, Maximize, Minimize, Shield } from "lucide-react";
import { useNavigate } from "react-router";

export function LogoDropdown() {
  const { isAuthenticated, signOut } = useAuth();
  const navigate = useNavigate();
  const fullscreen = useFullScreen();

  const handleSignOut = async () => {
    try {
      if (fullscreen.active) await fullscreen.toggle();
      await signOut();
      navigate("/");
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  const handleGoHome = () => {
    navigate("/");
  };

  const handleAdmin = () => {
    navigate("/admin");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-10 w-10">
          <img
            src={logo}
            alt="Logo"
            width={32}
            height={32}
            className="rounded-lg"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem onClick={handleGoHome} className="cursor-pointer">
          <Home className="mr-2 h-4 w-4" />
          Home
        </DropdownMenuItem>
        {isAuthenticated && fullscreen.supported && !fullscreen.installed && (
          <DropdownMenuItem
            onClick={() => void fullscreen.toggle()}
            className="cursor-pointer"
          >
            {fullscreen.active ? (
              <Minimize className="mr-2 h-4 w-4" />
            ) : (
              <Maximize className="mr-2 h-4 w-4" />
            )}
            {fullscreen.active ? "Exit full screen" : "Full screen"}
          </DropdownMenuItem>
        )}
        {isAuthenticated && (
          <>
            <DropdownMenuItem onClick={handleAdmin} className="cursor-pointer">
              <Shield className="mr-2 h-4 w-4" />
              Admin area
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="cursor-pointer text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
