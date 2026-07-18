import {
  BrowserRouter,
  Routes,
  Route
} from "react-router-dom";


import Layout from "./layouts/Layout";


import Home from "./pages/Home";
import Products from "./pages/Products";
import Cart from "./pages/Cart";


function App() {


  return (

    <BrowserRouter>


      <Layout>


        <Routes>


          <Route
            path="/"
            element={<Home />}
          />


          <Route
            path="/products"
            element={<Products />}
          />


          <Route
            path="/cart"
            element={<Cart />}
          />


          <Route
            path="/login"
            element={
              <h1>
                Customer Account
              </h1>
            }
          />


        </Routes>


      </Layout>


    </BrowserRouter>

  );

}


export default App;
