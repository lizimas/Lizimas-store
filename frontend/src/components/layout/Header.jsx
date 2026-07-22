import { Link } from "react-router-dom";
import { useCart } from "../../context/CartContext";

import Navigation from "./Navigation";

function Header() {

  const { totalItems } = useCart();

  return (

    <header>

      <div className="container header-container">

        <Link
          to="/"
          className="brand"
        >

          <img
            src="/images/logo/logo.png"
            alt="Lizimas Logo"
          />

          <h1>
            Lizimas & Talent Enterprise
          </h1>

        </Link>

        <div className="header-actions">

          <button aria-label="Search">
            🔍
          </button>

          <button aria-label="Wishlist">
            ❤️
          </button>

          <Link
            to="/cart"
            className="cart-button"
          >

            🛒

            {totalItems > 0 && (

              <span className="cart-badge">

                {totalItems}

              </span>

            )}

          </Link>

          <button aria-label="Account">
            👤
          </button>

        </div>

      </div>

      <Navigation />

    </header>

  );

}

export default Header;
