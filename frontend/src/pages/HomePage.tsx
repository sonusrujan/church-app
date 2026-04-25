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
      <Link to="/signin" className="splash-logo-link">
        <img src={shalomLogo} alt="Shalom" className="splash-logo" />
      </Link>
    </section>
  );
}
