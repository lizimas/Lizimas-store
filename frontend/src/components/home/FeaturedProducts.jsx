import { useEffect, useState } from "react";
import { getProducts } from "../../services/productService";
import ProductCard from "../ProductCard";


function FeaturedProducts(){

  const [products,setProducts] = useState([]);

  useEffect(()=>{

    loadProducts();

  },[]);


  const loadProducts = async()=>{

    try{

      const data = await getProducts();

      setProducts(data.slice(0,8));

    }catch(error){

      console.log(
        "Failed loading products",
        error
      );

    }

  };


  return (

    <section className="featured-products">

      <div className="container">


        <h2>
          Featured Products
        </h2>


        <div className="product-grid">


          {products.map(product=>(

            <ProductCard
              key={product.id}
              product={product}
            />

          ))}


        </div>


      </div>


    </section>

  );

}


export default FeaturedProducts;
