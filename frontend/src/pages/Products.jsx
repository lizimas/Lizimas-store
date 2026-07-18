import { useEffect, useState } from "react";
import { getProducts } from "../services/productService";
import ProductCard from "../components/ProductCard";

function Products() {

  const [products, setProducts] = useState([]);

  useEffect(() => {
    getProducts()
      .then(data => {
        setProducts(data);
      })
      .catch(error => {
        console.log(error);
      });
  }, []);

  return (
    <div className="products-page">

      <h1>Our Products</h1>

      <div className="products-grid">

        {products.map(product => (
          <ProductCard
            key={product.id}
            product={product}
          />
        ))}

      </div>

    </div>
  );
}

export default Products;
