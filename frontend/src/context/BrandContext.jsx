import { createContext, useContext, useState, useEffect } from 'react';
import { listBrands } from '../api/brands';
import { useAuth } from './AuthContext';

const BrandContext = createContext(null);

export function BrandProvider({ children }) {
  const { user } = useAuth();
  const [brands, setBrands] = useState([]);
  const [activeBrand, setActiveBrand] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) { setBrands([]); setActiveBrand(null); return; }
    setLoading(true);
    listBrands()
      .then(r => {
        const list = r.data.data || [];
        setBrands(list);
        const saved = localStorage.getItem('ardent_brand');
        const found = list.find(b => b.id === saved) || list[0] || null;
        setActiveBrand(found);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const switchBrand = (brand) => {
    setActiveBrand(brand);
    localStorage.setItem('ardent_brand', brand.id);
  };

  return (
    <BrandContext.Provider value={{ brands, activeBrand, loading, switchBrand, setBrands }}>
      {children}
    </BrandContext.Provider>
  );
}

export const useBrand = () => useContext(BrandContext);
