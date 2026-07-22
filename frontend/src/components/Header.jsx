import { Link } from "react-router-dom";

function Header() {
  return (
    <header className="header">
      <div className="logo">
        Lizimas & Talent Enterprise
      </div>

      <nav>
        <Link to="/">Home</Link>
        <Link to="/products">Products</Link>
        <Link to="/cart">Cart 🛒</Link>
        <Link to="/login">Account</Link>
      </nav>
    </header>
  );
}

export default Header;
