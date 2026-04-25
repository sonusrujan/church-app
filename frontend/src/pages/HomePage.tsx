import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import shalomLogo from "../assets/shalom-logo.png";

export default function HomePage() {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => navigate("/signin"), 3000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <section className="auth-shell splash-screen">
      <Link to="/signin" className="splash-logo-link" aria-label="Go to sign in">
        <img src={shalomLogo} alt="Shalom Church App" className="splash-logo" />
        <h1 className="splash-title">Shalom</h1>
        <p className="splash-tagline">Church Management Made Simple</p>
      </Link>
      <p className="splash-hint">Tap to continue</p>
    </section>
  );
}
