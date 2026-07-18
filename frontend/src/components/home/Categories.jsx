const categories = [

  {
    name: "Supermarket",
    image: "/images/products/supermarket/rice.jpg",
    description: "Fresh groceries and daily essentials"
  },

  {
    name: "Boutique",
    image: "/images/products/boutique/shirt.jpg",
    description: "Quality fashion and clothing"
  },

  {
    name: "Beverages",
    image: "/images/products/beverages/coca-cola.jpg",
    description: "Drinks for every occasion"
  },

  {
    name: "Household",
    image: "/images/products/household/detergent.jpg",
    description: "Everything for your home"
  }

];


function Categories(){

  return (

    <section className="categories">

      <div className="container">

        <h2>
          Shop By Category
        </h2>


        <div className="category-grid">


          {categories.map((category,index)=>(

            <div
              className="category-card"
              key={index}
            >

              <img
                src={category.image}
                alt={category.name}
              />


              <h3>
                {category.name}
              </h3>


              <p>
                {category.description}
              </p>


            </div>

          ))}


        </div>


      </div>

    </section>

  );

}


export default Categories;
